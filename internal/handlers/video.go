package handlers

import (
	"fmt"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/kompound-ca/videocutter/internal/models"
	"github.com/kompound-ca/videocutter/internal/services"
)

type VideoHandler struct {
	videoService *services.VideoService
	fileService  *services.FileService
}

func NewVideoHandler(videoService *services.VideoService, fileService *services.FileService) *VideoHandler {
	return &VideoHandler{
		videoService: videoService,
		fileService:  fileService,
	}
}

// Upload handles video file upload
func (vh *VideoHandler) Upload(c *fiber.Ctx) error {
	// Parse multipart form
	file, err := c.FormFile("video")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "No video file provided",
		})
	}

	// Validate file format
	if !vh.videoService.ValidateVideoFormat(file.Filename) {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Unsupported video format. Supported formats: MP4, AVI, MOV, MKV",
		})
	}

	// Validate file size
	if err := vh.fileService.ValidateFileSize(file.Size); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: err.Error(),
		})
	}

	// Open uploaded file
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Message: "Failed to process uploaded file",
		})
	}
	defer src.Close()

	// Save uploaded file
	savedPath, err := vh.fileService.SaveUploadedFile(src, file.Filename)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to save file: %v", err),
		})
	}

	// Get video metadata
	metadata, err := vh.videoService.GetVideoMetadata(savedPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to extract video metadata: %v", err),
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Video uploaded successfully",
		Data:    metadata,
	})
}

// GetMetadata returns video metadata for a given filename
func (vh *VideoHandler) GetMetadata(c *fiber.Ctx) error {
	filename := c.Params("filename")
	if filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Filename parameter required",
		})
	}

	filePath := vh.fileService.GetFilePath(filename)
	if !vh.fileService.FileExists(filename) {
		return c.Status(fiber.StatusNotFound).JSON(models.APIResponse{
			Success: false,
			Message: "Video file not found",
		})
	}

	metadata, err := vh.videoService.GetVideoMetadata(filePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to extract metadata: %v", err),
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Metadata retrieved successfully",
		Data:    metadata,
	})
}

// Cut handles video cutting requests
func (vh *VideoHandler) Cut(c *fiber.Ctx) error {
	var req models.CutRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Invalid request body",
		})
	}

	// Validate input
	if req.Filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Filename is required",
		})
	}

	if req.StartTime >= req.EndTime {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "End time must be after start time",
		})
	}

	// Check if input file exists
	inputPath := vh.fileService.GetFilePath(req.Filename)
	if !vh.fileService.FileExists(req.Filename) {
		return c.Status(fiber.StatusNotFound).JSON(models.APIResponse{
			Success: false,
			Message: "Input video file not found",
		})
	}

	// Generate output filename
	outputFilename := vh.fileService.GenerateOutputFilename(req.Filename)
	outputPath := vh.fileService.GetFilePath(outputFilename)

	// Perform video cutting
	if err := vh.videoService.CutVideo(inputPath, outputPath, req.StartTime, req.EndTime); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to cut video: %v", err),
		})
	}

	// Return success response
	cutResponse := models.CutResponse{
		OutputFilename: outputFilename,
		Success:        true,
		Message:        "Video cut successfully",
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Video cut completed",
		Data:    cutResponse,
	})
}

// Download serves the processed video file
func (vh *VideoHandler) Download(c *fiber.Ctx) error {
	filename := c.Params("filename")
	if filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Filename parameter required",
		})
	}

	filePath := vh.fileService.GetFilePath(filename)
	if !vh.fileService.FileExists(filename) {
		return c.Status(fiber.StatusNotFound).JSON(models.APIResponse{
			Success: false,
			Message: "File not found",
		})
	}

	// Set appropriate headers for video download
	ext := filepath.Ext(filename)
	var contentType string
	switch ext {
	case ".mp4":
		contentType = "video/mp4"
	case ".avi":
		contentType = "video/x-msvideo"
	case ".mov":
		contentType = "video/quicktime"
	case ".mkv":
		contentType = "video/x-matroska"
	default:
		contentType = "application/octet-stream"
	}

	c.Set("Content-Type", contentType)
	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))

	return c.SendFile(filePath)
}

// Preview serves the uploaded video file for preview
func (vh *VideoHandler) Preview(c *fiber.Ctx) error {
	filename := c.Params("filename")
	if filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Filename parameter required",
		})
	}

	// Log for debugging
	fmt.Printf("Preview request for filename: %s\n", filename)

	filePath := vh.fileService.GetFilePath(filename)
	if !vh.fileService.FileExists(filename) {
		return c.Status(fiber.StatusNotFound).JSON(models.APIResponse{
			Success: false,
			Message: "File not found",
		})
	}

	// Set appropriate headers for video streaming
	ext := filepath.Ext(filename)
	var contentType string
	switch ext {
	case ".mp4":
		contentType = "video/mp4"
	case ".avi":
		contentType = "video/x-msvideo"
	case ".mov":
		contentType = "video/quicktime"
	case ".mkv":
		contentType = "video/x-matroska"
	case ".webm":
		contentType = "video/webm"
	case ".m4v":
		contentType = "video/mp4"
	default:
		contentType = "application/octet-stream"
	}

	c.Set("Content-Type", contentType)
	c.Set("Accept-Ranges", "bytes") // Enable seeking
	c.Set("Cache-Control", "no-cache")

	return c.SendFile(filePath)
}

// ParseDuration parses duration from string (in seconds) to time.Duration
func ParseDuration(durationStr string) (time.Duration, error) {
	seconds, err := strconv.ParseFloat(durationStr, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid duration format: %w", err)
	}
	return time.Duration(seconds * float64(time.Second)), nil
}