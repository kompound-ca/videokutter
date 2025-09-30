package services

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/kompound-ca/videocutter/internal/models"
)

// PreviewStatus represents the status of preview generation
type PreviewStatus string

const (
	PreviewStatusPending    PreviewStatus = "pending"
	PreviewStatusGenerating PreviewStatus = "generating"
	PreviewStatusReady      PreviewStatus = "ready"
	PreviewStatusFailed     PreviewStatus = "failed"
)

// PreviewInfo holds information about preview generation
type PreviewInfo struct {
	OriginalFilename string        `json:"original_filename"`
	PreviewFilename  string        `json:"preview_filename"`
	Status           PreviewStatus `json:"status"`
	Progress         int           `json:"progress"` // 0-100
	Error            string        `json:"error,omitempty"`
	CreatedAt        time.Time     `json:"created_at"`
	CompletedAt      *time.Time    `json:"completed_at,omitempty"`
	Duration         time.Duration `json:"duration,omitempty"`
}

// OptimizedPreviewService handles smart preview generation with browser compatibility detection
type OptimizedPreviewService struct {
	tempDir         string
	ffprobeService  *FFprobeService
	previewSessions map[string]*PreviewInfo
	mutex           sync.RWMutex
	// Background workers
	workerPool chan struct{} // Limit concurrent preview generations
}

// NewOptimizedPreviewService creates a new optimized preview service
func NewOptimizedPreviewService(tempDir string, ffprobeService *FFprobeService) *OptimizedPreviewService {
	return &OptimizedPreviewService{
		tempDir:         tempDir,
		ffprobeService:  ffprobeService,
		previewSessions: make(map[string]*PreviewInfo),
		workerPool:      make(chan struct{}, 2), // Max 2 concurrent preview generations
	}
}

// CheckBrowserCompatibility determines if a video needs preview generation
func (ops *OptimizedPreviewService) CheckBrowserCompatibility(metadata *models.VideoMetadata) bool {
	return ops.ffprobeService.DetectBrowserCompatibility(metadata)
}

// RequestPreview initiates preview generation if needed (async)
func (ops *OptimizedPreviewService) RequestPreview(originalFilename string, filePath string, metadata *models.VideoMetadata) (*PreviewInfo, error) {
	ops.mutex.Lock()
	defer ops.mutex.Unlock()

	// Check if preview already exists or is being generated
	if info, exists := ops.previewSessions[originalFilename]; exists {
		return info, nil
	}

	// Check if preview is needed
	if ops.CheckBrowserCompatibility(metadata) {
		// Browser compatible - no preview needed
		return &PreviewInfo{
			OriginalFilename: originalFilename,
			Status:           PreviewStatusReady,
			Progress:         100,
			CreatedAt:        time.Now(),
		}, nil
	}

	// Create preview info
	previewInfo := &PreviewInfo{
		OriginalFilename: originalFilename,
		PreviewFilename:  ops.generatePreviewFilename(originalFilename),
		Status:           PreviewStatusPending,
		Progress:         0,
		CreatedAt:        time.Now(),
	}

	ops.previewSessions[originalFilename] = previewInfo

	// Start async preview generation
	go ops.generatePreviewAsync(originalFilename, filePath, metadata)

	return previewInfo, nil
}

// GetPreviewStatus returns the current status of preview generation
func (ops *OptimizedPreviewService) GetPreviewStatus(originalFilename string) (*PreviewInfo, error) {
	ops.mutex.RLock()
	defer ops.mutex.RUnlock()

	info, exists := ops.previewSessions[originalFilename]
	if !exists {
		return nil, fmt.Errorf("no preview session found for filename: %s", originalFilename)
	}

	return info, nil
}

// GetPreviewPath returns the path to a preview file if ready
func (ops *OptimizedPreviewService) GetPreviewPath(originalFilename string) (string, bool) {
	ops.mutex.RLock()
	defer ops.mutex.RUnlock()

	info, exists := ops.previewSessions[originalFilename]
	if !exists || info.Status != PreviewStatusReady || info.PreviewFilename == "" {
		return "", false
	}

	previewPath := filepath.Join(ops.tempDir, info.PreviewFilename)
	if _, err := os.Stat(previewPath); err != nil {
		return "", false
	}

	return previewPath, true
}

// generatePreviewAsync generates preview in background with progress tracking
func (ops *OptimizedPreviewService) generatePreviewAsync(originalFilename, filePath string, metadata *models.VideoMetadata) {
	// Acquire worker slot
	ops.workerPool <- struct{}{}
	defer func() { <-ops.workerPool }()

	ops.updatePreviewStatus(originalFilename, PreviewStatusGenerating, 10, "")

	previewPath := filepath.Join(ops.tempDir, ops.previewSessions[originalFilename].PreviewFilename)

	// Determine optimal encoding settings based on input format
	encodingProfile := ops.selectEncodingProfile(metadata)
	
	ops.updatePreviewStatus(originalFilename, PreviewStatusGenerating, 25, "")

	// Build FFmpeg command with progress tracking
	cmd := exec.Command("ffmpeg",
		"-i", filePath,
		"-c:v", encodingProfile.VideoCodec,
		"-preset", encodingProfile.Preset,
		"-crf", encodingProfile.CRF,
		"-vf", encodingProfile.VideoFilter,
		"-c:a", encodingProfile.AudioCodec,
		"-b:a", encodingProfile.AudioBitrate,
		"-movflags", "+faststart", // Enable web streaming
		"-f", "mp4",
		"-y", // Overwrite output
		previewPath)

	ops.updatePreviewStatus(originalFilename, PreviewStatusGenerating, 50, "")

	// Execute with context for timeout
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	cmd = exec.CommandContext(ctx, cmd.Args[0], cmd.Args[1:]...)
	
	startTime := time.Now()
	output, err := cmd.CombinedOutput()
	duration := time.Since(startTime)

	if err != nil {
		errorMsg := fmt.Sprintf("FFmpeg failed: %v, stderr: %s", err, string(output))
		ops.updatePreviewStatusWithError(originalFilename, PreviewStatusFailed, errorMsg)
		return
	}

	ops.updatePreviewStatusComplete(originalFilename, duration)
}

// EncodingProfile defines encoding parameters for different scenarios
type EncodingProfile struct {
	VideoCodec    string
	Preset        string
	CRF           string
	VideoFilter   string
	AudioCodec    string
	AudioBitrate  string
	Description   string
}

// selectEncodingProfile chooses optimal encoding settings based on input metadata
func (ops *OptimizedPreviewService) selectEncodingProfile(metadata *models.VideoMetadata) EncodingProfile {
	// For MOV files (often ProRes/high quality)
	if strings.Contains(strings.ToLower(metadata.Format), "mov") {
		return EncodingProfile{
			VideoCodec:   "libx264",
			Preset:       "fast", // Good balance for high-quality sources
			CRF:          "24",   // Higher quality for professional content
			VideoFilter:  "scale=-2:720", // Downscale to 720p
			AudioCodec:   "aac",
			AudioBitrate: "128k",
			Description:  "MOV/ProRes optimized",
		}
	}

	// For large files that need aggressive compression
	if metadata.Size > 1024*1024*1024 { // > 1GB
		return EncodingProfile{
			VideoCodec:   "libx264",
			Preset:       "veryfast",
			CRF:          "26",
			VideoFilter:  "scale=-2:720",
			AudioCodec:   "aac",
			AudioBitrate: "96k",
			Description:  "Large file optimized",
		}
	}

	// Default profile for most content
	return EncodingProfile{
		VideoCodec:   "libx264",
		Preset:       "fast",
		CRF:          "25",
		VideoFilter:  "scale=-2:720",
		AudioCodec:   "aac",
		AudioBitrate: "128k",
		Description:  "Standard preview",
	}
}

// generatePreviewFilename creates a safe filename for preview files
func (ops *OptimizedPreviewService) generatePreviewFilename(originalFilename string) string {
	// Extract base name without extension
	baseName := strings.TrimSuffix(filepath.Base(originalFilename), filepath.Ext(originalFilename))
	
	// Clean the base name for safety
	safeName := strings.ReplaceAll(baseName, " ", "_")
	safeName = strings.ReplaceAll(safeName, "-", "_")
	
	// Add timestamp and preview suffix
	timestamp := time.Now().Format("150405")
	return fmt.Sprintf("%s_%s_preview.mp4", safeName, timestamp)
}

// updatePreviewStatus updates the status of a preview generation session
func (ops *OptimizedPreviewService) updatePreviewStatus(filename string, status PreviewStatus, progress int, error string) {
	ops.mutex.Lock()
	defer ops.mutex.Unlock()

	if info, exists := ops.previewSessions[filename]; exists {
		info.Status = status
		info.Progress = progress
		if error != "" {
			info.Error = error
		}
	}
}

// updatePreviewStatusWithError updates preview status with error
func (ops *OptimizedPreviewService) updatePreviewStatusWithError(filename string, status PreviewStatus, error string) {
	ops.mutex.Lock()
	defer ops.mutex.Unlock()

	if info, exists := ops.previewSessions[filename]; exists {
		info.Status = status
		info.Progress = 0
		info.Error = error
		now := time.Now()
		info.CompletedAt = &now
	}
}

// updatePreviewStatusComplete marks preview as complete
func (ops *OptimizedPreviewService) updatePreviewStatusComplete(filename string, duration time.Duration) {
	ops.mutex.Lock()
	defer ops.mutex.Unlock()

	if info, exists := ops.previewSessions[filename]; exists {
		info.Status = PreviewStatusReady
		info.Progress = 100
		info.Duration = duration
		now := time.Now()
		info.CompletedAt = &now
	}
}

// CleanupPreview removes preview files and session data
func (ops *OptimizedPreviewService) CleanupPreview(originalFilename string) error {
	ops.mutex.Lock()
	defer ops.mutex.Unlock()

	info, exists := ops.previewSessions[originalFilename]
	if !exists {
		return nil // Nothing to clean up
	}

	// Remove preview file if it exists
	if info.PreviewFilename != "" {
		previewPath := filepath.Join(ops.tempDir, info.PreviewFilename)
		if err := os.Remove(previewPath); err != nil && !os.IsNotExist(err) {
			fmt.Printf("Warning: failed to remove preview file %s: %v\n", previewPath, err)
		}
	}

	// Remove session data
	delete(ops.previewSessions, originalFilename)

	return nil
}

// GetActivePreviewCount returns the number of active preview generation sessions
func (ops *OptimizedPreviewService) GetActivePreviewCount() int {
	ops.mutex.RLock()
	defer ops.mutex.RUnlock()

	count := 0
	for _, info := range ops.previewSessions {
		if info.Status == PreviewStatusGenerating || info.Status == PreviewStatusPending {
			count++
		}
	}
	return count
}