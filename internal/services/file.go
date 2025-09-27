package services

import (
	"fmt"
	"io"
	"math/rand"
	"os"
	"path/filepath"
	"time"
)

type FileService struct {
	tempDir       string
	maxFileSize   int64
	lastProcessed string
}

func NewFileService() *FileService {
	tempDir := os.Getenv("TEMP_DIR")
	if tempDir == "" {
		tempDir = "./temp"
	}

	// Ensure temp directory exists
	os.MkdirAll(tempDir, 0755)

	return &FileService{
		tempDir:     tempDir,
		maxFileSize: 10 * 1024 * 1024 * 1024, // 10GB
	}
}

// SaveUploadedFile saves an uploaded file to the temp directory
func (fs *FileService) SaveUploadedFile(src io.Reader, filename string) (string, error) {
	// Clean up previous files before saving new one
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

	// Copy with size limit
	limitedReader := io.LimitReader(src, fs.maxFileSize+1) // +1 to detect oversized files
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
