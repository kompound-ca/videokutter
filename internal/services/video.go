package services

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
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

// GeneratePreview creates a browser-compatible 720p preview using lightweight encoding
func (vs *VideoService) GeneratePreview(inputPath string, originalFilename string) (string, error) {
	// Generate safe preview filename
	previewFilename := vs.generateSafePreviewFilename()
	previewPath := filepath.Join(vs.tempDir, previewFilename)

	// Use FFmpeg to create a lightweight H.264 preview downscaled to 720p
	// This reduces file size significantly and improves browser performance
	cmd := exec.Command("ffmpeg",
		"-i", inputPath,
		"-c:v", "libx264", // H.264 codec (widely supported)
		"-preset", "veryfast", // Fast encoding preset (better quality than ultrafast)
		"-crf", "26", // Good quality vs size balance for preview
		"-vf", "scale=-2:720", // Downscale to 720p height, maintain aspect ratio
		"-c:a", "aac", // AAC audio (widely supported)
		"-b:a", "96k", // Lower audio bitrate for preview
		"-movflags", "+faststart", // Enable web streaming
		"-f", "mp4", // MP4 container
		"-y", // Overwrite output file if exists
		previewPath)

	// Run command and capture output
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("ffmpeg preview generation failed: %w, stderr: %s", err, string(output))
	}

	return previewFilename, nil
}

// generateSafePreviewFilename creates a safe filename for preview files
func (vs *VideoService) generateSafePreviewFilename() string {
	// Simple word lists for generating safe filenames
	adjectives := []string{"bright", "swift", "smooth", "clear", "sharp", "quick", "light", "fast", "clean", "fresh"}
	nouns := []string{"preview", "sample", "demo", "clip", "video", "media", "stream", "play", "view", "show"}
	
	// Generate random filename
	adj := adjectives[rand.Intn(len(adjectives))]
	noun := nouns[rand.Intn(len(nouns))]
	timestamp := time.Now().Format("150405") // HHMMSS format
	
	return fmt.Sprintf("%s_%s_%s_preview.mp4", adj, noun, timestamp)
}

// formatDuration converts time.Duration to HH:MM:SS.mmm format for ffmpeg
func formatDuration(d time.Duration) string {
	hours := int(d.Hours())
	minutes := int(d.Minutes()) % 60
	seconds := int(d.Seconds()) % 60
	milliseconds := int(d.Nanoseconds()/1000000) % 1000
	
	return fmt.Sprintf("%02d:%02d:%02d.%03d", hours, minutes, seconds, milliseconds)
}

// StreamPreview720p streams a 720p version of the video on-the-fly
func (vs *VideoService) StreamPreview720p(c *fiber.Ctx, inputPath string) error {
	// Generate unique temp filename for this 720p stream
	previewFilename := vs.generateSafePreviewFilename()
	previewPath := filepath.Join(vs.tempDir, previewFilename)

	// Start FFmpeg process to transcode to 720p and pipe to stdout
	cmd := exec.Command("ffmpeg",
		"-i", inputPath,
		"-c:v", "libx264", // H.264 codec (widely supported)
		"-preset", "ultrafast", // Fastest encoding for real-time
		"-crf", "28", // Reasonable quality for preview
		"-vf", "scale=-2:720", // Downscale to 720p height, maintain aspect ratio
		"-c:a", "aac", // AAC audio (widely supported)
		"-b:a", "96k", // Lower audio bitrate
		"-movflags", "frag_keyframe+empty_moov", // Enable streaming
		"-f", "mp4", // MP4 container
		"-y", // Overwrite if exists
		previewPath)

	// Execute command and wait for it to complete
	output, err := cmd.CombinedOutput()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString(fmt.Sprintf("Failed to generate 720p preview: %v, stderr: %s", err, string(output)))
	}

	// Set headers for video streaming
	c.Set("Content-Type", "video/mp4")
	c.Set("Accept-Ranges", "bytes")
	c.Set("Cache-Control", "public, max-age=3600") // Cache for 1 hour

	// Serve the generated 720p file
	defer func() {
		// Clean up temp preview file after serving
		go func() {
			time.Sleep(10 * time.Second) // Wait a bit for download to complete
			os.Remove(previewPath)
		}()
	}()

	return c.SendFile(previewPath)
}
