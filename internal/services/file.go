package services

import (
	"fmt"
	"io"
	"math/rand"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kompound-ca/videocutter/internal/models"
)

type FileService struct {
	tempDir       string
	maxFileSize   int64
	lastProcessed string
	// Chunked upload fields
	chunksDir     string
	sessions      map[string]*models.UploadSession
	sessionsMutex sync.RWMutex
	defaultChunkSize int64
}

func NewFileService() *FileService {
	tempDir := os.Getenv("TEMP_DIR")
	if tempDir == "" {
		tempDir = "./temp"
	}

	// Setup directories
	chunksDir := filepath.Join(tempDir, "chunks")
	os.MkdirAll(tempDir, 0755)
	os.MkdirAll(chunksDir, 0755)

	return &FileService{
		tempDir:          tempDir,
		maxFileSize:      10 * 1024 * 1024 * 1024, // 10GB
		chunksDir:        chunksDir,
		sessions:         make(map[string]*models.UploadSession),
		defaultChunkSize: 5 * 1024 * 1024, // 5MB chunks
	}
}

// SaveUploadedFile saves an uploaded file to the temp directory using streaming
func (fs *FileService) SaveUploadedFile(src io.Reader, filename string) (string, error) {
	// Clean up older files BEFORE saving new one to avoid deleting the fresh upload
	if err := fs.CleanupPreviousFiles(); err != nil {
		// Log warning but don't fail the upload
		fmt.Printf("Warning: failed to cleanup previous files: %v\n", err)
	}

	// Generate safe random filename
	ext := filepath.Ext(filename)
	safeFilename := fs.generateSafeFilename(ext)
	
	filepath := filepath.Join(fs.tempDir, safeFilename)

	// Create destination file
	dst, err := os.Create(filepath)
	if err != nil {
		return "", fmt.Errorf("failed to create file: %w", err)
	}
	defer dst.Close()

	// Use standard io.Copy with size limit for reliability
	limitedReader := io.LimitReader(src, fs.maxFileSize+1)
	written, err := io.Copy(dst, limitedReader)
	if err != nil {
		os.Remove(filepath) // Clean up on error
		return "", fmt.Errorf("failed to save file: %w", err)
	}

	// Check if file exceeds size limit
	if written > fs.maxFileSize {
		os.Remove(filepath)
		return "", fmt.Errorf("file size exceeds 10GB limit")
	}

	return filepath, nil
}

// GetFilePath returns the full path for a filename in temp directory
func (fs *FileService) GetFilePath(filename string) string {
	return filepath.Join(fs.tempDir, filename)
}

// FileExists checks if a file exists in the temp directory
func (fs *FileService) FileExists(filename string) bool {
	filepath := fs.GetFilePath(filename)
	_, err := os.Stat(filepath)
	return err == nil
}

// GenerateOutputFilename creates a unique filename for processed video
func (fs *FileService) GenerateOutputFilename(originalFilename string) string {
	ext := filepath.Ext(originalFilename)
	
	// Generate safe random filename with 'cut' suffix
	outputName := fs.generateSafeFilename(ext, "cut")
	fs.lastProcessed = outputName
	
	return outputName
}

// GetLastProcessedFile returns the filename of the last processed video
func (fs *FileService) GetLastProcessedFile() string {
	return fs.lastProcessed
}

// CleanupPreviousFiles removes all files from temp directory except the last processed one
func (fs *FileService) CleanupPreviousFiles() error {
	entries, err := os.ReadDir(fs.tempDir)
	if err != nil {
		return fmt.Errorf("failed to read temp directory: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filename := entry.Name()
		// Keep the last processed file
		if filename == fs.lastProcessed {
			continue
		}

		filepath := fs.GetFilePath(filename)
		if err := os.Remove(filepath); err != nil {
			fmt.Printf("Warning: failed to remove file %s: %v\n", filepath, err)
		}
	}

	return nil
}

// GetFileSize returns the size of a file
func (fs *FileService) GetFileSize(filepath string) (int64, error) {
	info, err := os.Stat(filepath)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

// GetTempDir returns the temporary directory path
func (fs *FileService) GetTempDir() string {
	return fs.tempDir
}

// ValidateFileSize checks if file size is within limits
func (fs *FileService) ValidateFileSize(size int64) error {
	if size > fs.maxFileSize {
		return fmt.Errorf("file size %d bytes exceeds maximum limit of %d bytes (10GB)", size, fs.maxFileSize)
	}
	return nil
}

// generateSafeFilename creates a safe filename with random words
func (fs *FileService) generateSafeFilename(ext string, suffix ...string) string {
	// Simple word lists for generating safe filenames
	adjectives := []string{"happy", "swift", "bright", "calm", "fresh", "quick", "smart", "cool", "warm", "clean"}
	nouns := []string{"cat", "dog", "bird", "fish", "tree", "rock", "star", "moon", "sun", "wave"}
	
	// Generate random filename
	adj := adjectives[rand.Intn(len(adjectives))]
	noun := nouns[rand.Intn(len(nouns))]
	timestamp := time.Now().Format("150405") // HHMMSS format
	
	filename := fmt.Sprintf("%s_%s_%s", adj, noun, timestamp)
	
	// Add suffix if provided
	if len(suffix) > 0 {
		filename = fmt.Sprintf("%s_%s", filename, suffix[0])
	}
	
	return filename + ext
}

// Chunked Upload Methods

// InitializeUpload creates a new upload session
func (fs *FileService) InitializeUpload(originalName string, fileSize, chunkSize int64) (*models.UploadSession, error) {
	if chunkSize <= 0 {
		chunkSize = fs.defaultChunkSize
	}

	// Generate unique session ID and safe filename
	uploadID := uuid.New().String()
	ext := filepath.Ext(originalName)
	safeFilename := fs.generateSafeFilename(ext)

	// Calculate total chunks
	totalChunks := int((fileSize + chunkSize - 1) / chunkSize)

	// Create upload session
	session := &models.UploadSession{
		ID:             uploadID,
		Filename:       safeFilename,
		OriginalName:   originalName,
		TotalSize:      fileSize,
		ChunkSize:      chunkSize,
		TotalChunks:    totalChunks,
		UploadedChunks: make(map[int]bool),
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	// Store session
	fs.sessionsMutex.Lock()
	fs.sessions[uploadID] = session
	fs.sessionsMutex.Unlock()

	// Create session directory
	sessionDir := filepath.Join(fs.chunksDir, uploadID)
	os.MkdirAll(sessionDir, 0755)

	return session, nil
}

// GetUploadSession retrieves an upload session
func (fs *FileService) GetUploadSession(uploadID string) (*models.UploadSession, error) {
	fs.sessionsMutex.RLock()
	session, exists := fs.sessions[uploadID]
	fs.sessionsMutex.RUnlock()

	if !exists {
		return nil, fmt.Errorf("upload session not found: %s", uploadID)
	}

	return session, nil
}

// HasUploadSession checks if an upload session exists
func (fs *FileService) HasUploadSession(uploadID string) bool {
	fs.sessionsMutex.RLock()
	_, exists := fs.sessions[uploadID]
	fs.sessionsMutex.RUnlock()
	return exists
}

// SaveChunk saves a chunk to the session directory
func (fs *FileService) SaveChunk(uploadID string, chunkIndex int, data io.Reader) error {
	session, err := fs.GetUploadSession(uploadID)
	if err != nil {
		return err
	}

	// Create chunk file
	chunkPath := filepath.Join(fs.chunksDir, uploadID, fmt.Sprintf("chunk_%d", chunkIndex))
	chunkFile, err := os.Create(chunkPath)
	if err != nil {
		return fmt.Errorf("failed to create chunk file: %w", err)
	}
	defer chunkFile.Close()

	// Copy chunk data
	limitedReader := io.LimitReader(data, session.ChunkSize+1024) // Small buffer for safety
	_, err = io.Copy(chunkFile, limitedReader)
	if err != nil {
		return fmt.Errorf("failed to save chunk: %w", err)
	}

	// Mark chunk as uploaded
	fs.sessionsMutex.Lock()
	session.UploadedChunks[chunkIndex] = true
	session.UpdatedAt = time.Now()
	fs.sessionsMutex.Unlock()

	return nil
}

// IsChunkUploaded checks if a specific chunk is already uploaded
func (fs *FileService) IsChunkUploaded(uploadID string, chunkIndex int) bool {
	fs.sessionsMutex.RLock()
	session, exists := fs.sessions[uploadID]
	fs.sessionsMutex.RUnlock()

	if !exists {
		return false
	}

	return session.UploadedChunks[chunkIndex]
}

// GetMissingChunks returns a list of missing chunk indices
func (fs *FileService) GetMissingChunks(uploadID string) ([]int, error) {
	session, err := fs.GetUploadSession(uploadID)
	if err != nil {
		return nil, err
	}

	var missing []int
	for i := 0; i < session.TotalChunks; i++ {
		if !session.UploadedChunks[i] {
			missing = append(missing, i)
		}
	}

	return missing, nil
}

// AssembleChunks combines all chunks into the final file
func (fs *FileService) AssembleChunks(uploadID string) (string, error) {
	session, err := fs.GetUploadSession(uploadID)
	if err != nil {
		return "", err
	}

	// Check if all chunks are uploaded
	if len(session.UploadedChunks) != session.TotalChunks {
		return "", fmt.Errorf("not all chunks uploaded: %d/%d", len(session.UploadedChunks), session.TotalChunks)
	}

	// Create final file
	finalPath := filepath.Join(fs.tempDir, session.Filename)
	finalFile, err := os.Create(finalPath)
	if err != nil {
		return "", fmt.Errorf("failed to create final file: %w", err)
	}
	defer finalFile.Close()

	// Assemble chunks in order
	for i := 0; i < session.TotalChunks; i++ {
		chunkPath := filepath.Join(fs.chunksDir, uploadID, fmt.Sprintf("chunk_%d", i))
		chunkFile, err := os.Open(chunkPath)
		if err != nil {
			return "", fmt.Errorf("failed to open chunk %d: %w", i, err)
		}

		_, err = io.Copy(finalFile, chunkFile)
		chunkFile.Close()
		if err != nil {
			return "", fmt.Errorf("failed to copy chunk %d: %w", i, err)
		}
	}

	// Cleanup session
	fs.CleanupSession(uploadID)

	return finalPath, nil
}

// CleanupSession removes the session and its chunks
func (fs *FileService) CleanupSession(uploadID string) {
	// Remove session directory
	sessionDir := filepath.Join(fs.chunksDir, uploadID)
	os.RemoveAll(sessionDir)

	// Remove session from memory
	fs.sessionsMutex.Lock()
	delete(fs.sessions, uploadID)
	fs.sessionsMutex.Unlock()
}
