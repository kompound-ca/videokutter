package models

import "time"

// VideoMetadata represents metadata extracted from a video file
type VideoMetadata struct {
	Filename    string        `json:"filename"`
	Duration    time.Duration `json:"duration"`
	Format      string        `json:"format"`
	Resolution  string        `json:"resolution"`
	Size        int64         `json:"size"`
	Bitrate     string        `json:"bitrate"`
	FrameRate   string        `json:"framerate"`
	AudioCodec  string        `json:"audio_codec"`
	VideoCodec  string        `json:"video_codec"`
	UploadedAt  time.Time     `json:"uploaded_at"`
}

// CutRequest represents a video cutting request
type CutRequest struct {
	Filename  string        `json:"filename"`
	StartTime time.Duration `json:"start_time"`
	EndTime   time.Duration `json:"end_time"`
}

// CutResponse represents the response after cutting a video
type CutResponse struct {
	OutputFilename string `json:"output_filename"`
	Success        bool   `json:"success"`
	Message        string `json:"message"`
}

// APIResponse represents a generic API response
type APIResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}