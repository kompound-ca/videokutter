package handlers

import (
	"fmt"
	"net/url"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/kompound-ca/videocutter/internal/models"
	"github.com/kompound-ca/videocutter/internal/services"
)

type VideoHandler struct {
	videoService   *services.VideoService
	fileService    *services.FileService
	cleanupService *services.CleanupService
}

func NewVideoHandler(videoService *services.VideoService, fileService *services.FileService, cleanupService *services.CleanupService) *VideoHandler {
	return &VideoHandler{
		videoService:   videoService,
		fileService:    fileService,
		cleanupService: cleanupService,
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

	// Extract filename from saved path
	filename := filepath.Base(savedPath)

	// Create cleanup session for file management
	sessionID := uuid.New().String()
	vh.cleanupService.CreateSession(sessionID, filename)

	// Return success immediately with basic info
	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Video uploaded successfully",
		Data: map[string]interface{}{
			"session_id": sessionID,
			"filename":   filename,
			"size":       file.Size,
			"uploaded":   true,
			"note":       "Preview will be automatically downscaled to 720p",
		},
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

	// Update session access time if session_id provided
	sessionID := c.Query("session_id")
	if sessionID != "" {
		vh.cleanupService.UpdateSessionAccess(sessionID)
	}

	// URL decode the filename
	decodedFilename, err := url.QueryUnescape(filename)
	if err != nil {
		decodedFilename = filename // fallback to original if decoding fails
	}
	filename = decodedFilename

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

// Cut parameters logged at debug level (suppressed in production)

	// Perform video cutting
	if err := vh.videoService.CutVideo(inputPath, outputPath, req.StartTime, req.EndTime); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to cut video: %v", err),
		})
	}

	// Update cleanup session with processed file
	sessionID := c.Query("session_id")
	if sessionID != "" {
		vh.cleanupService.SetProcessedFile(sessionID, outputFilename)
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

	// URL decode the filename
	decodedFilename, err := url.QueryUnescape(filename)
	if err != nil {
		decodedFilename = filename // fallback to original if decoding fails
	}
	filename = decodedFilename

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

	// Record download activity if session_id provided
	sessionID := c.Query("session_id")
	if sessionID != "" {
		vh.cleanupService.RecordDownload(sessionID)
	}

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

	// URL decode the filename
	decodedFilename, err := url.QueryUnescape(filename)
	if err != nil {
		decodedFilename = filename // fallback to original if decoding fails
	}

	// Log for debugging
	fmt.Printf("Preview request for filename: %s (decoded: %s)\n", filename, decodedFilename)
	filename = decodedFilename

	// Serve original video with optimization headers for browser
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
	c.Set("Cache-Control", "public, max-age=3600") // Cache for 1 hour
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("Connection", "keep-alive")
	
	// Add headers to improve streaming performance
	if contentType == "video/mp4" {
		c.Set("Content-Disposition", "inline") // Encourage inline playback
	}

	// Update session access time if session_id provided
	sessionID := c.Query("session_id")
	if sessionID != "" {
		vh.cleanupService.UpdateSessionAccess(sessionID)
	}

	fmt.Printf("Serving original video for preview: %s\n", filename)
	return c.SendFile(filePath)
}

// GeneratePreview creates a browser-compatible preview version
func (vh *VideoHandler) GeneratePreview(c *fiber.Ctx) error {
	filename := c.Params("filename")
	if filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Filename parameter required",
		})
	}

	// URL decode the filename
	decodedFilename, err := url.QueryUnescape(filename)
	if err != nil {
		decodedFilename = filename // fallback to original if decoding fails
	}

	// Log for debugging
	fmt.Printf("Generate preview request for filename: %s (decoded: %s)\n", filename, decodedFilename)
	filename = decodedFilename

	inputPath := vh.fileService.GetFilePath(filename)
	if !vh.fileService.FileExists(filename) {
		return c.Status(fiber.StatusNotFound).JSON(models.APIResponse{
			Success: false,
			Message: "Input video file not found",
		})
	}

	// Generate preview filename
	previewFilename, err := vh.videoService.GeneratePreview(inputPath, filename)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to generate preview: %v", err),
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Preview generated successfully",
		Data: map[string]string{
			"preview_filename": previewFilename,
		},
	})
}

// Chunked Upload Handlers

// InitUpload initializes a chunked upload session
func (vh *VideoHandler) InitUpload(c *fiber.Ctx) error {
	var req models.InitUploadRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Invalid request body",
		})
	}

	// Validate file format
	if !vh.videoService.ValidateVideoFormat(req.Filename) {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Unsupported video format. Supported formats: MP4, AVI, MOV, MKV, WebM, M4V",
		})
	}

	// Validate file size
	if err := vh.fileService.ValidateFileSize(req.FileSize); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: err.Error(),
		})
	}

	// Initialize upload session
	session, err := vh.fileService.InitializeUpload(req.Filename, req.FileSize, req.ChunkSize)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to initialize upload: %v", err),
		})
	}

	response := models.InitUploadResponse{
		UploadID:    session.ID,
		ChunkSize:   session.ChunkSize,
		TotalChunks: session.TotalChunks,
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Upload session initialized",
		Data:    response,
	})
}

// UploadChunk handles individual chunk uploads
func (vh *VideoHandler) UploadChunk(c *fiber.Ctx) error {
	uploadID := c.FormValue("upload_id")
	chunkIndexStr := c.FormValue("chunk_index")

	if uploadID == "" || chunkIndexStr == "" {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Missing upload_id or chunk_index",
		})
	}

	chunkIndex, err := strconv.Atoi(chunkIndexStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Invalid chunk_index",
		})
	}

	// Check if chunk is already uploaded (resume capability)
	if vh.fileService.IsChunkUploaded(uploadID, chunkIndex) {
		return c.JSON(models.APIResponse{
			Success: true,
			Message: "Chunk already uploaded",
			Data: models.ChunkUploadResponse{
				UploadID:   uploadID,
				ChunkIndex: chunkIndex,
				Uploaded:   true,
			},
		})
	}

	// Get chunk file from form
	file, err := c.FormFile("chunk")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "No chunk file provided",
		})
	}

	// Open chunk file
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Message: "Failed to process chunk file",
		})
	}
	defer src.Close()

	// Save chunk
	err = vh.fileService.SaveChunk(uploadID, chunkIndex, src)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to save chunk: %v", err),
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Chunk uploaded successfully",
		Data: models.ChunkUploadResponse{
			UploadID:   uploadID,
			ChunkIndex: chunkIndex,
			Uploaded:   true,
		},
	})
}

// GetUploadStatus returns the current upload status
func (vh *VideoHandler) GetUploadStatus(c *fiber.Ctx) error {
	uploadID := c.Params("upload_id")
	if uploadID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Upload ID required",
		})
	}

	session, err := vh.fileService.GetUploadSession(uploadID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(models.APIResponse{
			Success: false,
			Message: "Upload session not found",
		})
	}

	missingChunks, _ := vh.fileService.GetMissingChunks(uploadID)

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Upload status retrieved",
		Data: map[string]interface{}{
			"upload_id":       session.ID,
			"total_chunks":    session.TotalChunks,
			"uploaded_chunks": len(session.UploadedChunks),
			"missing_chunks":  missingChunks,
			"complete":        len(missingChunks) == 0,
		},
	})
}

// CompleteUpload finalizes the chunked upload
func (vh *VideoHandler) CompleteUpload(c *fiber.Ctx) error {
	var req models.CompleteUploadRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Invalid request body",
		})
	}

	// Check if all chunks are uploaded
	missingChunks, err := vh.fileService.GetMissingChunks(req.UploadID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(models.APIResponse{
			Success: false,
			Message: "Upload session not found",
		})
	}

	if len(missingChunks) > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: fmt.Sprintf("Missing chunks: %v", missingChunks),
		})
	}

	// Get session info before cleanup (AssembleChunks will clean up the session)
	session, err := vh.fileService.GetUploadSession(req.UploadID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(models.APIResponse{
			Success: false,
			Message: "Upload session not found",
		})
	}

	// Assemble chunks into final file
	finalPath, err := vh.fileService.AssembleChunks(req.UploadID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to assemble file: %v", err),
		})
	}

	filename := filepath.Base(finalPath)

	// Create cleanup session for chunked upload
	sessionID := uuid.New().String()
	vh.cleanupService.CreateSession(sessionID, filename)

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Upload completed successfully",
		Data: map[string]interface{}{
			"session_id": sessionID,
			"filename":   filename,
			"size":       session.TotalSize,
			"uploaded":   true,
		},
	})
}

// ParseDuration parses duration from string (in seconds) to time.Duration
func ParseDuration(durationStr string) (time.Duration, error) {
	seconds, err := strconv.ParseFloat(durationStr, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid duration format: %w", err)
	}
	return time.Duration(seconds * float64(time.Second)), nil
}
