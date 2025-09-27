package services

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/kompound-ca/videocutter/internal/models"
)

type VideoService struct {
	tempDir string
}

func NewVideoService() *VideoService {
	tempDir := os.Getenv("TEMP_DIR")
	if tempDir == "" {
		tempDir = "./temp"
	}

	// Ensure temp directory exists
	os.MkdirAll(tempDir, 0755)

	return &VideoService{
		tempDir: tempDir,
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

// GetVideoMetadata extracts metadata from video using ffprobe
func (vs *VideoService) GetVideoMetadata(filePath string) (*models.VideoMetadata, error) {
	cmd := exec.Command("ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		filePath)

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to run ffprobe: %w", err)
	}

	var probe FFProbeOutput
	if err := json.Unmarshal(output, &probe); err != nil {
		return nil, fmt.Errorf("failed to parse ffprobe output: %w", err)
	}

	// Parse duration
	durationFloat, err := strconv.ParseFloat(probe.Format.Duration, 64)
	if err != nil {
		return nil, fmt.Errorf("failed to parse duration: %w", err)
	}
	duration := time.Duration(durationFloat * float64(time.Second))

	// Parse size
	size, err := strconv.ParseInt(probe.Format.Size, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("failed to parse file size: %w", err)
	}

	// Find video and audio streams
	var videoCodec, audioCodec, resolution, frameRate string
	for _, stream := range probe.Streams {
		if stream.CodecType == "video" {
			videoCodec = stream.CodecName
			if stream.Width > 0 && stream.Height > 0 {
				resolution = fmt.Sprintf("%dx%d", stream.Width, stream.Height)
			}
			if stream.RFrameRate != "" {
				frameRate = stream.RFrameRate
			}
		} else if stream.CodecType == "audio" && audioCodec == "" {
			audioCodec = stream.CodecName
		}
	}

	filename := filepath.Base(filePath)
	
	return &models.VideoMetadata{
		Filename:    filename,
		Duration:    duration,
		Format:      probe.Format.FormatName,
		Resolution:  resolution,
		Size:        size,
		Bitrate:     probe.Format.BitRate,
		FrameRate:   frameRate,
		AudioCodec:  audioCodec,
		VideoCodec:  videoCodec,
		UploadedAt:  time.Now(),
	}, nil
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

	// Capture stderr for error reporting
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	// Read stderr output
	stderrOutput := make([]byte, 4096)
	n, _ := stderr.Read(stderrOutput)
	stderr.Close()

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("ffmpeg failed: %w, stderr: %s", err, string(stderrOutput[:n]))
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