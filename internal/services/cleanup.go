package services

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// FileSession represents a user's file processing session
type FileSession struct {
	ID                string    `json:"id"`
	UploadedFile      string    `json:"uploaded_file"`
	ProcessedFile     string    `json:"processed_file"`
	LastAccessTime    time.Time `json:"last_access_time"`
	CreatedAt         time.Time `json:"created_at"`
	DownloadCount     int       `json:"download_count"`
	IsDownloadReady   bool      `json:"is_download_ready"`
}

// CleanupService manages file lifecycle and automatic cleanup
type CleanupService struct {
	tempDir         string
	chunksDir       string
	sessions        map[string]*FileSession
	sessionsMutex   sync.RWMutex
	cleanupInterval time.Duration
	maxFileAge      time.Duration
	stopChan        chan struct{}
	fileService     *FileService
}

// NewCleanupService creates a new cleanup service
func NewCleanupService(fileService *FileService) *CleanupService {
	cs := &CleanupService{
		tempDir:         fileService.GetTempDir(),
		chunksDir:       filepath.Join(fileService.GetTempDir(), "chunks"),
		sessions:        make(map[string]*FileSession),
		cleanupInterval: 1 * time.Minute,  // Check every minute
		maxFileAge:      5 * time.Minute,  // Delete files after 5 minutes of inactivity
		stopChan:        make(chan struct{}),
		fileService:     fileService,
	}
	
	// Start background cleanup routine
	go cs.startCleanupRoutine()
	
	return cs
}

// CreateSession creates a new file session for tracking
func (cs *CleanupService) CreateSession(sessionID, uploadedFile string) *FileSession {
	cs.sessionsMutex.Lock()
	defer cs.sessionsMutex.Unlock()
	
	session := &FileSession{
		ID:             sessionID,
		UploadedFile:   uploadedFile,
		LastAccessTime: time.Now(),
		CreatedAt:      time.Now(),
		DownloadCount:  0,
		IsDownloadReady: false,
	}
	
	cs.sessions[sessionID] = session
	return session
}

// UpdateSessionAccess updates the last access time for a session
func (cs *CleanupService) UpdateSessionAccess(sessionID string) {
	cs.sessionsMutex.Lock()
	defer cs.sessionsMutex.Unlock()
	
	if session, exists := cs.sessions[sessionID]; exists {
		session.LastAccessTime = time.Now()
	}
}

// SetProcessedFile sets the processed file for a session
func (cs *CleanupService) SetProcessedFile(sessionID, processedFile string) {
	cs.sessionsMutex.Lock()
	defer cs.sessionsMutex.Unlock()
	
	if session, exists := cs.sessions[sessionID]; exists {
		session.ProcessedFile = processedFile
		session.IsDownloadReady = true
		session.LastAccessTime = time.Now()
	}
}

// RecordDownload increments download count for a session
func (cs *CleanupService) RecordDownload(sessionID string) {
	cs.sessionsMutex.Lock()
	defer cs.sessionsMutex.Unlock()
	
	if session, exists := cs.sessions[sessionID]; exists {
		session.DownloadCount++
		session.LastAccessTime = time.Now()
	}
}

// GetSession retrieves a session by ID
func (cs *CleanupService) GetSession(sessionID string) (*FileSession, bool) {
	cs.sessionsMutex.RLock()
	defer cs.sessionsMutex.RUnlock()
	
	session, exists := cs.sessions[sessionID]
	return session, exists
}

// CleanupSession immediately removes a session and its files
func (cs *CleanupService) CleanupSession(sessionID string) error {
	cs.sessionsMutex.Lock()
	session, exists := cs.sessions[sessionID]
	if !exists {
		cs.sessionsMutex.Unlock()
		return fmt.Errorf("session not found: %s", sessionID)
	}
	
	// Remove from memory first
	delete(cs.sessions, sessionID)
	cs.sessionsMutex.Unlock()
	
	// Clean up files
	var errors []error
	
	if session.UploadedFile != "" {
		filePath := filepath.Join(cs.tempDir, session.UploadedFile)
		if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
			errors = append(errors, fmt.Errorf("failed to remove uploaded file %s: %w", filePath, err))
		}
	}
	
	if session.ProcessedFile != "" {
		filePath := filepath.Join(cs.tempDir, session.ProcessedFile)
		if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
			errors = append(errors, fmt.Errorf("failed to remove processed file %s: %w", filePath, err))
		}
	}
	
	if len(errors) > 0 {
		return fmt.Errorf("cleanup errors: %v", errors)
	}
	
	return nil
}

// startCleanupRoutine runs the background cleanup process
func (cs *CleanupService) startCleanupRoutine() {
	ticker := time.NewTicker(cs.cleanupInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			cs.performCleanup()
		case <-cs.stopChan:
			return
		}
	}
}

// performCleanup removes expired sessions and files
func (cs *CleanupService) performCleanup() {
	now := time.Now()
	var expiredSessions []string
	
	cs.sessionsMutex.RLock()
	for sessionID, session := range cs.sessions {
		if now.Sub(session.LastAccessTime) > cs.maxFileAge {
			expiredSessions = append(expiredSessions, sessionID)
		}
	}
	cs.sessionsMutex.RUnlock()
	
	// Clean up expired sessions
	for _, sessionID := range expiredSessions {
		if err := cs.CleanupSession(sessionID); err != nil {
			fmt.Printf("Warning: failed to cleanup expired session %s: %v\n", sessionID, err)
		} else {
			fmt.Printf("Cleaned up expired session: %s\n", sessionID)
		}
	}
	
	// Clean up orphaned upload sessions (chunks)
	cs.cleanupOrphanedChunks()
	
	// Clean up any orphaned files in temp directory
	cs.cleanupOrphanedFiles()
}

// cleanupOrphanedChunks removes old chunked upload sessions
func (cs *CleanupService) cleanupOrphanedChunks() {
	if _, err := os.Stat(cs.chunksDir); os.IsNotExist(err) {
		return
	}
	
	entries, err := os.ReadDir(cs.chunksDir)
	if err != nil {
		fmt.Printf("Warning: failed to read chunks directory: %v\n", err)
		return
	}
	
	now := time.Now()
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		
		// Check if this is an active upload session
		sessionID := entry.Name()
		if cs.fileService.HasUploadSession(sessionID) {
			continue
		}
		
		// Check age of directory
		info, err := entry.Info()
		if err != nil {
			continue
		}
		
		if now.Sub(info.ModTime()) > cs.maxFileAge {
			chunkDir := filepath.Join(cs.chunksDir, sessionID)
			if err := os.RemoveAll(chunkDir); err != nil {
				fmt.Printf("Warning: failed to remove orphaned chunk directory %s: %v\n", chunkDir, err)
			} else {
				fmt.Printf("Cleaned up orphaned chunk directory: %s\n", chunkDir)
			}
		}
	}
}

// cleanupOrphanedFiles removes files not tracked by any session
func (cs *CleanupService) cleanupOrphanedFiles() {
	entries, err := os.ReadDir(cs.tempDir)
	if err != nil {
		fmt.Printf("Warning: failed to read temp directory: %v\n", err)
		return
	}
	
	// Get list of tracked files
	cs.sessionsMutex.RLock()
	trackedFiles := make(map[string]bool)
	for _, session := range cs.sessions {
		if session.UploadedFile != "" {
			trackedFiles[session.UploadedFile] = true
		}
		if session.ProcessedFile != "" {
			trackedFiles[session.ProcessedFile] = true
		}
	}
	cs.sessionsMutex.RUnlock()
	
	now := time.Now()
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		
		filename := entry.Name()
		
		// Skip tracked files
		if trackedFiles[filename] {
			continue
		}
		
		// Check file age
		info, err := entry.Info()
		if err != nil {
			continue
		}
		
		if now.Sub(info.ModTime()) > cs.maxFileAge {
			filePath := filepath.Join(cs.tempDir, filename)
			if err := os.Remove(filePath); err != nil {
				fmt.Printf("Warning: failed to remove orphaned file %s: %v\n", filePath, err)
			} else {
				fmt.Printf("Cleaned up orphaned file: %s\n", filename)
			}
		}
	}
}

// GetSessionStats returns statistics about active sessions
func (cs *CleanupService) GetSessionStats() map[string]interface{} {
	cs.sessionsMutex.RLock()
	defer cs.sessionsMutex.RUnlock()
	
	stats := map[string]interface{}{
		"active_sessions": len(cs.sessions),
		"cleanup_interval_minutes": cs.cleanupInterval.Minutes(),
		"max_file_age_minutes": cs.maxFileAge.Minutes(),
	}
	
	downloadReady := 0
	for _, session := range cs.sessions {
		if session.IsDownloadReady {
			downloadReady++
		}
	}
	stats["download_ready_sessions"] = downloadReady
	
	return stats
}

// Stop stops the cleanup service
func (cs *CleanupService) Stop() {
	close(cs.stopChan)
}