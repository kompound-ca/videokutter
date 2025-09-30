package services

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/kompound-ca/videocutter/internal/models"
)

type VideoService struct {
	tempDir     string
	ffprobeService *FFprobeService
}

func NewVideoService() *VideoService {
	tempDir := os.Getenv("TEMP_DIR")
	if tempDir == "" {
		tempDir = "./temp"
	}

	// Ensure temp directory exists
	os.MkdirAll(tempDir, 0755)

	return &VideoService{
		tempDir:        tempDir,
		ffprobeService: NewFFprobeService(),
	}
}

// FFProbeOutput represents the structure of ffprobe JSON output
type FFProbeOutput struct {
	Streams []struct {
		Index          int    `json:"index"`
		CodecName      string `json:"codec_name"`
		CodecType      string `json:"codec_type"`
		Width          int    `json:"width,omitempty"`
		Height         int    `json:"height,omitempty"`
		RFrameRate     string `json:"r_frame_rate,omitempty"`
		AvgFrameRate   string `json:"avg_frame_rate,omitempty"`
		Duration       string `json:"duration,omitempty"`
		BitRate        string `json:"bit_rate,omitempty"`
	} `json:"streams"`
	Format struct {
		Filename   string `json:"filename"`
		FormatName string `json:"format_name"`
		Duration   string `json:"duration"`
		Size       string `json:"size"`
		BitRate    string `json:"bit_rate"`
	} `json:"format"`
}

// GetVideoMetadata extracts metadata from video using optimized ffprobe
func (vs *VideoService) GetVideoMetadata(filePath string) (*models.VideoMetadata, error) {
	// Try fast metadata extraction first
	metadata, err := vs.ffprobeService.FastMetadataExtraction(filePath)
	if err != nil {
		// Fall back to standard extraction if fast method fails
		metadata, err = vs.ffprobeService.StandardMetadataExtraction(filePath)
		if err != nil {
			return nil, fmt.Errorf("failed to extract metadata: %w", err)
		}
	}

	return metadata, nil
}

// CutVideo performs lossless video cutting using ffmpeg
func (vs *VideoService) CutVideo(inputPath string, outputPath string, startTime, endTime time.Duration) error {
	// Calculate duration for the cut
	cutDuration := endTime - startTime
	if cutDuration <= 0 {
		return fmt.Errorf("invalid cut duration: end time must be after start time")
	}

	// Format times for ffmpeg (HH:MM:SS.mmm format)
	startTimeStr := formatDuration(startTime)
	durationStr := formatDuration(cutDuration)

	// Use ffmpeg to cut the video losslessly
	cmd := exec.Command("ffmpeg",
		"-i", inputPath,
		"-ss", startTimeStr,
		"-t", durationStr,
		"-c", "copy", // Copy streams without re-encoding (lossless)
		"-avoid_negative_ts", "make_zero",
		"-y", // Overwrite output file if exists
		outputPath)

	// Run command and capture output
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("ffmpeg failed: %w, stderr: %s", err, string(output))
	}

	return nil
}

// ValidateVideoFormat checks if the video format is supported
func (vs *VideoService) ValidateVideoFormat(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	// Support common video container formats that can contain various codecs including AV1
	supportedFormats := []string{".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}
	
	for _, format := range supportedFormats {
		if ext == format {
			return true
		}
	}
	return false
}

// GetTempDir returns the temporary directory path
func (vs *VideoService) GetTempDir() string {
	return vs.tempDir
}



// formatDuration converts time.Duration to HH:MM:SS.mmm format for ffmpeg
func formatDuration(d time.Duration) string {
	hours := int(d.Hours())
	minutes := int(d.Minutes()) % 60
	seconds := int(d.Seconds()) % 60
	milliseconds := int(d.Nanoseconds()/1000000) % 1000
	
	return fmt.Sprintf("%02d:%02d:%02d.%03d", hours, minutes, seconds, milliseconds)
}

