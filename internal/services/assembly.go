package services

import (
	"crypto/sha256"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/kompound-ca/videocutter/internal/models"
)

// AssemblyService handles optimized chunked file assembly
type AssemblyService struct {
	tempDir         string
	chunksDir       string
	maxConcurrency  int
	semaphore       chan struct{} // Semaphore to limit concurrent assemblies
	mutex           sync.Mutex
	activeJobs      map[string]*AssemblyJob
}

// AssemblyJob represents a single file assembly operation
type AssemblyJob struct {
	UploadID    string
	Session     *models.UploadSession
	FinalPath   string
	StartTime   time.Time
	Hash        hash.Hash
	Progress    float64
	Error       error
	Completed   bool
}

// NewAssemblyService creates an optimized assembly service
func NewAssemblyService(tempDir, chunksDir string) *AssemblyService {
	// Limit concurrent assemblies to CPU count (or 2 minimum for dual-core prod VM)
	maxConcurrency := runtime.NumCPU()
	if maxConcurrency < 2 {
		maxConcurrency = 2
	}

	return &AssemblyService{
		tempDir:        tempDir,
		chunksDir:      chunksDir,
		maxConcurrency: maxConcurrency,
		semaphore:      make(chan struct{}, maxConcurrency),
		activeJobs:     make(map[string]*AssemblyJob),
	}
}

// AssembleChunksOptimized performs optimized assembly with pre-allocation and hashing
func (as *AssemblyService) AssembleChunksOptimized(session *models.UploadSession) (string, error) {
	// For files < 500MB, use memory-based assembly for better performance
	if session.TotalSize < 500*1024*1024 {
		return as.assembleInMemory(session)
	}

	// Use disk-based assembly for larger files
	return as.assembleOnDisk(session)
}

// assembleInMemory performs in-memory assembly for smaller files
func (as *AssemblyService) assembleInMemory(session *models.UploadSession) (string, error) {
	uploadID := session.ID

	// Acquire semaphore slot for concurrency control
	as.semaphore <- struct{}{}
	defer func() { <-as.semaphore }()

	// Track this assembly job
	job := &AssemblyJob{
		UploadID:  uploadID,
		Session:   session,
		StartTime: time.Now(),
		Hash:      sha256.New(),
	}

	as.mutex.Lock()
	as.activeJobs[uploadID] = job
	as.mutex.Unlock()

	defer func() {
		as.mutex.Lock()
		delete(as.activeJobs, uploadID)
		as.mutex.Unlock()
	}()

	// Allocate memory buffer for entire file
	buffer := make([]byte, session.TotalSize)
	var totalBytesRead int64

	// Read all chunks into memory buffer
	for i := 0; i < session.TotalChunks; i++ {
		chunkPath := filepath.Join(as.chunksDir, uploadID, fmt.Sprintf("chunk_%d", i))
		
		// Calculate offset for this chunk
		offset := int64(i) * session.ChunkSize

		// Read chunk directly into buffer at correct offset
		bytesRead, err := as.readChunkToBuffer(buffer[offset:], chunkPath, job.Hash)
		if err != nil {
			job.Error = err
			return "", fmt.Errorf("failed to read chunk %d: %w", i, err)
		}

		totalBytesRead += bytesRead
		job.Progress = float64(i+1) / float64(session.TotalChunks)
	}

	// Verify total size
	if totalBytesRead != session.TotalSize {
		job.Error = fmt.Errorf("size mismatch: expected %d, got %d", session.TotalSize, totalBytesRead)
		return "", job.Error
	}

	// Write entire buffer to final file in one operation
	finalPath := filepath.Join(as.tempDir, session.Filename)
	job.FinalPath = finalPath

	if err := as.writeBufferToFile(buffer, finalPath); err != nil {
		job.Error = err
		return "", fmt.Errorf("failed to write final file: %w", err)
	}

	job.Completed = true
	return finalPath, nil
}

// assembleOnDisk performs traditional disk-based assembly for larger files
func (as *AssemblyService) assembleOnDisk(session *models.UploadSession) (string, error) {
	// Acquire semaphore slot for concurrency control
	as.semaphore <- struct{}{}
	defer func() { <-as.semaphore }()

	// Track this assembly job
	job := &AssemblyJob{
		UploadID:  session.ID,
		Session:   session,
		StartTime: time.Now(),
		Hash:      sha256.New(),
	}

	as.mutex.Lock()
	as.activeJobs[session.ID] = job
	as.mutex.Unlock()

	defer func() {
		as.mutex.Lock()
		delete(as.activeJobs, session.ID)
		as.mutex.Unlock()
	}()

	// Generate final path
	finalPath := filepath.Join(as.tempDir, session.Filename)
	job.FinalPath = finalPath

	// Pre-allocate the final file with known size
	if err := as.preallocateFile(finalPath, session.TotalSize); err != nil {
		job.Error = err
		return "", fmt.Errorf("failed to pre-allocate file: %w", err)
	}

	// Open final file for writing
	finalFile, err := os.OpenFile(finalPath, os.O_WRONLY, 0644)
	if err != nil {
		job.Error = err
		return "", fmt.Errorf("failed to open final file: %w", err)
	}
	defer finalFile.Close()

	// Assemble chunks by writing directly to their offsets
	var totalBytesWritten int64
	for i := 0; i < session.TotalChunks; i++ {
		chunkPath := filepath.Join(as.chunksDir, session.ID, fmt.Sprintf("chunk_%d", i))
		
		// Calculate offset for this chunk
		offset := int64(i) * session.ChunkSize

		// Read and write chunk at correct offset
		bytesWritten, err := as.writeChunkAtOffset(finalFile, chunkPath, offset, job.Hash)
		if err != nil {
			job.Error = err
			return "", fmt.Errorf("failed to write chunk %d: %w", i, err)
		}

		totalBytesWritten += bytesWritten
		job.Progress = float64(i+1) / float64(session.TotalChunks)
	}

	// Ensure all data is written to disk
	if err := finalFile.Sync(); err != nil {
		job.Error = err
		return "", fmt.Errorf("failed to sync final file: %w", err)
	}

	// Verify file size
	if totalBytesWritten != session.TotalSize {
		job.Error = fmt.Errorf("size mismatch: expected %d, got %d", session.TotalSize, totalBytesWritten)
		return "", job.Error
	}

	job.Completed = true
	return finalPath, nil
}

// preallocateFile creates a file with the specified size using sparse file allocation
func (as *AssemblyService) preallocateFile(filepath string, size int64) error {
	file, err := os.Create(filepath)
	if err != nil {
		return err
	}
	defer file.Close()

	// Try to use fallocate on Linux, fallback to Truncate on Windows
	if err := as.fallocate(file, size); err != nil {
		// Fallback: use Truncate (works on all platforms)
		if err := file.Truncate(size); err != nil {
			return fmt.Errorf("failed to pre-allocate file space: %w", err)
		}
	}

	return nil
}

// fallocate attempts platform-specific file preallocation
func (as *AssemblyService) fallocate(file *os.File, size int64) error {
	// Try Linux fallocate syscall first
	if r1, _, _ := syscall.Syscall6(syscall.SYS_FALLOCATE, file.Fd(), 0, 0, uintptr(size), 0, 0); r1 == 0 {
		return nil
	}
	
	// Fallback to truncate (works on Windows and other platforms)
	return file.Truncate(size)
}

// writeChunkAtOffset writes a chunk to the final file at the specified offset
func (as *AssemblyService) writeChunkAtOffset(finalFile *os.File, chunkPath string, offset int64, hasher hash.Hash) (int64, error) {
	// Open chunk file
	chunkFile, err := os.Open(chunkPath)
	if err != nil {
		return 0, err
	}
	defer chunkFile.Close()

	// Seek to the correct position in final file
	if _, err := finalFile.Seek(offset, io.SeekStart); err != nil {
		return 0, fmt.Errorf("failed to seek to offset %d: %w", offset, err)
	}

	// Use TeeReader to hash while copying
	teeReader := io.TeeReader(chunkFile, hasher)

	// Copy chunk data to final file
	bytesWritten, err := io.Copy(finalFile, teeReader)
	if err != nil {
		return 0, fmt.Errorf("failed to copy chunk data: %w", err)
	}

	return bytesWritten, nil
}

// GetAssemblyProgress returns progress information for an active assembly
func (as *AssemblyService) GetAssemblyProgress(uploadID string) *AssemblyJob {
	as.mutex.Lock()
	defer as.mutex.Unlock()
	
	if job, exists := as.activeJobs[uploadID]; exists {
		// Return a copy to avoid race conditions
		return &AssemblyJob{
			UploadID:  job.UploadID,
			FinalPath: job.FinalPath,
			StartTime: job.StartTime,
			Progress:  job.Progress,
			Error:     job.Error,
			Completed: job.Completed,
		}
	}
	return nil
}

// AtomicMoveToProcessing atomically moves assembled file to processing directory
func (as *AssemblyService) AtomicMoveToProcessing(sourcePath, targetPath string) error {
	// Use os.Rename for atomic move (same filesystem)
	if err := os.Rename(sourcePath, targetPath); err != nil {
		// If rename fails (cross-filesystem), fall back to copy + delete
		if err := as.copyFile(sourcePath, targetPath); err != nil {
			return fmt.Errorf("failed to copy file: %w", err)
		}
		if err := os.Remove(sourcePath); err != nil {
			// Log warning but don't fail - target file is already created
			fmt.Printf("Warning: failed to remove source file %s: %v\n", sourcePath, err)
		}
	}
	return nil
}

// copyFile copies a file from source to destination
func (as *AssemblyService) copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, sourceFile)
	if err != nil {
		return err
	}

	return destFile.Sync()
}

// readChunkToBuffer reads a chunk file directly into a memory buffer
func (as *AssemblyService) readChunkToBuffer(buffer []byte, chunkPath string, hasher hash.Hash) (int64, error) {
	chunkFile, err := os.Open(chunkPath)
	if err != nil {
		return 0, err
	}
	defer chunkFile.Close()

	// Read chunk data into buffer
	n, err := io.ReadFull(chunkFile, buffer[:cap(buffer)])
	if err != nil && err != io.ErrUnexpectedEOF {
		return 0, fmt.Errorf("failed to read chunk: %w", err)
	}

	// Update hash
	if _, hashErr := hasher.Write(buffer[:n]); hashErr != nil {
		return 0, fmt.Errorf("failed to update hash: %w", hashErr)
	}

	return int64(n), nil
}

// writeBufferToFile writes a memory buffer to a file in one operation
func (as *AssemblyService) writeBufferToFile(buffer []byte, filePath string) error {
	// Create file with optimized flags
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer file.Close()

	// Write entire buffer in one operation
	n, err := file.Write(buffer)
	if err != nil {
		return fmt.Errorf("failed to write buffer: %w", err)
	}

	if n != len(buffer) {
		return fmt.Errorf("incomplete write: wrote %d bytes, expected %d", n, len(buffer))
	}

	// Ensure data is written to disk
	if err := file.Sync(); err != nil {
		return fmt.Errorf("failed to sync file: %w", err)
	}

	return nil
}

// GetFileHash returns the SHA256 hash of an assembled file
func (as *AssemblyService) GetFileHash(uploadID string) string {
	as.mutex.Lock()
	defer as.mutex.Unlock()
	
	if job, exists := as.activeJobs[uploadID]; exists && job.Hash != nil {
		return fmt.Sprintf("%x", job.Hash.Sum(nil))
	}
	return ""
}
