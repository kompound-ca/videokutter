package services

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"time"

	"github.com/kompound-ca/videocutter/internal/models"
)

// FFprobeService handles optimized video metadata extraction
type FFprobeService struct {
	ffprobePath string
}

// NewFFprobeService creates an optimized FFprobe service
func NewFFprobeService() *FFprobeService {
	return &FFprobeService{
		ffprobePath: "ffprobe", // Assumes ffprobe is in PATH
	}
}

// FastMetadataExtraction extracts essential metadata without scanning entire file
func (fps *FFprobeService) FastMetadataExtraction(filePath string) (*models.VideoMetadata, error) {
	// Use optimized ffprobe command that reads minimal data
	cmd := exec.Command(fps.ffprobePath,
		"-v", "error",                    // Suppress verbose output
		"-print_format", "json",          // JSON output
		"-show_format",                   // Show container format
		"-show_streams",                  // Show stream info
		"-read_intervals", "0%+#1",       // Read only first frame/packet for speed
		"-select_streams", "v:0,a:0",     // Only first video and audio stream
		filePath)

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe failed: %w", err)
	}

	var probe FFProbeOutput
	if err := json.Unmarshal(output, &probe); err != nil {
		return nil, fmt.Errorf("failed to parse ffprobe output: %w", err)
	}

	return fps.parseMetadata(probe, filePath)
}

// StandardMetadataExtraction performs complete metadata extraction (fallback)
func (fps *FFprobeService) StandardMetadataExtraction(filePath string) (*models.VideoMetadata, error) {
	cmd := exec.Command(fps.ffprobePath,
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		filePath)

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe failed: %w", err)
	}

	var probe FFProbeOutput
	if err := json.Unmarshal(output, &probe); err != nil {
		return nil, fmt.Errorf("failed to parse ffprobe output: %w", err)
	}

	return fps.parseMetadata(probe, filePath)
}

// parseMetadata converts FFprobe output to VideoMetadata
func (fps *FFprobeService) parseMetadata(probe FFProbeOutput, filePath string) (*models.VideoMetadata, error) {
	// Parse duration
	var durationFloat float64
	var err error
	
	if probe.Format.Duration != "" {
		durationFloat, err = strconv.ParseFloat(probe.Format.Duration, 64)
		if err != nil {
			// Try to get duration from first video stream as fallback
			for _, stream := range probe.Streams {
				if stream.CodecType == "video" && stream.Duration != "" {
					if streamDuration, streamErr := strconv.ParseFloat(stream.Duration, 64); streamErr == nil {
						durationFloat = streamDuration
						break
					}
				}
			}
			if durationFloat == 0 {
				return nil, fmt.Errorf("failed to parse duration: %w", err)
			}
		}
	}
	
	duration := time.Duration(durationFloat * float64(time.Second))

	// Parse size
	var size int64
	if probe.Format.Size != "" {
		size, err = strconv.ParseInt(probe.Format.Size, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("failed to parse file size: %w", err)
		}
	}

	// Find video and audio streams
	var videoCodec, audioCodec, resolution, frameRate string
	var width, height int
	
	for _, stream := range probe.Streams {
		if stream.CodecType == "video" {
			videoCodec = stream.CodecName
			width = stream.Width
			height = stream.Height
			
			if width > 0 && height > 0 {
				resolution = fmt.Sprintf("%dx%d", width, height)
			}
			
			if stream.RFrameRate != "" {
				frameRate = stream.RFrameRate
			} else if stream.AvgFrameRate != "" {
				frameRate = stream.AvgFrameRate
			}
		} else if stream.CodecType == "audio" && audioCodec == "" {
			audioCodec = stream.CodecName
		}
	}

	filename := filePath
	if len(filePath) > 100 {
		// Use just filename if path is too long
		filename = filePath[len(filePath)-100:]
	}

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

// GeneratePosterThumbnail creates a poster image at 1 second mark
func (fps *FFprobeService) GeneratePosterThumbnail(inputPath, outputPath string) error {
	cmd := exec.Command("ffmpeg",
		"-ss", "1",                               // Seek to 1 second
		"-i", inputPath,                         // Input file
		"-frames:v", "1",                        // Extract 1 frame
		"-vf", "scale='min(1280,iw)':-1",       // Scale to max 1280 width, maintain aspect ratio
		"-q:v", "3",                            // High quality
		"-y",                                   // Overwrite output
		outputPath)

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to generate poster: %w", err)
	}

	return nil
}

// DetectBrowserCompatibility checks if video format is browser-playable
func (fps *FFprobeService) DetectBrowserCompatibility(metadata *models.VideoMetadata) bool {
	// Check container format
	supportedContainers := []string{"mp4", "webm", "ogg"}
	containerSupported := false
	
	for _, container := range supportedContainers {
		if metadata.Format == container {
			containerSupported = true
			break
		}
	}
	
	if !containerSupported {
		return false
	}

	// Check video codec
	supportedVideoCodecs := []string{"h264", "avc", "vp8", "vp9", "av01"} // av01 is AV1
	videoSupported := false
	
	for _, codec := range supportedVideoCodecs {
		if metadata.VideoCodec == codec {
			videoSupported = true
			break
		}
	}

	// Check audio codec (if present)
	audioSupported := true // Assume true if no audio
	if metadata.AudioCodec != "" {
		supportedAudioCodecs := []string{"aac", "mp3", "opus", "vorbis"}
		audioSupported = false
		
		for _, codec := range supportedAudioCodecs {
			if metadata.AudioCodec == codec {
				audioSupported = true
				break
			}
		}
	}

	return videoSupported && audioSupported
}

// GetOptimizedFFprobeArgs returns ffprobe arguments optimized for different scenarios
func (fps *FFprobeService) GetOptimizedFFprobeArgs(scenario string) []string {
	switch scenario {
	case "fast":
		// Fast metadata extraction - minimal read
		return []string{
			"-v", "error",
			"-print_format", "json",
			"-show_format",
			"-show_streams",
			"-read_intervals", "0%+#1", // Read only first packet
			"-select_streams", "v:0,a:0",
		}
	case "complete":
		// Complete metadata extraction
		return []string{
			"-v", "quiet",
			"-print_format", "json",
			"-show_format",
			"-show_streams",
		}
	case "duration-only":
		// Only extract duration (fastest)
		return []string{
			"-v", "error",
			"-show_entries", "format=duration",
			"-print_format", "csv=p=0",
		}
	default:
		return fps.GetOptimizedFFprobeArgs("fast")
	}
}