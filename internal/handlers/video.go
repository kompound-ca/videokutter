package handlers

import (
	"fmt"
	"net/url"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/kompound-ca/videocutter/internal/middleware"
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

	// Create cleanup session for file management with automatic cleanup of previous sessions
	sessionID := uuid.New().String()
	userID := c.Locals("userID").(string) // Use JWT user ID for session management
	vh.cleanupService.CreateSessionForUser(sessionID, filename, userID)

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

	// Note: Session access time is no longer updated to enforce strict 5-minute expiration
	// sessionID := c.Query("session_id")
	// Removed UpdateSessionAccess call to prevent timer extension

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
	
	// Log metadata extraction start
	middleware.LogTimingEvent(c, "metadata_extraction_start", map[string]interface{}{
		"filename": filename,
		"file_path": filePath,
	})

	metadata, err := vh.videoService.GetVideoMetadata(filePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to extract metadata: %v", err),
		})
	}
	
	// Log metadata extraction complete with optimization info
	middleware.LogTimingEvent(c, "metadata_extraction_complete", map[string]interface{}{
		"filename": filename,
		"duration_ns": metadata.Duration,
		"resolution": metadata.Resolution,
		"format": metadata.Format,
		"video_codec": metadata.VideoCodec,
		"optimization": "fast_extraction_used",
	})

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
	// Get user ID from JWT to find their active session
	userID := c.Locals("userID").(string)
	
	// Find and update the user's active session with the processed file
	vh.cleanupService.SetProcessedFileForUser(userID, outputFilename)

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

	// Get user ID from JWT middleware for file ownership validation
	userID := c.Locals("userID").(string)

	// Validate that the user owns this file by checking if they have a session with this file
	if !vh.cleanupService.UserOwnsFile(userID, filename) {
		return c.Status(fiber.StatusForbidden).JSON(models.APIResponse{
			Success: false,
			Message: "Access denied: You don't have permission to download this file",
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

	// Note: Download activity no longer extends session to enforce strict 5-minute expiration
	// sessionID := c.Query("session_id")
	// Removed RecordDownload call to prevent timer extension

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
	filename = decodedFilename

	// Get user ID from JWT middleware for file ownership validation
	userID := c.Locals("userID").(string)

	// Validate that the user owns this file by checking if they have a session with this file
	if !vh.cleanupService.UserOwnsFile(userID, filename) {
		return c.Status(fiber.StatusForbidden).JSON(models.APIResponse{
			Success: false,
			Message: "Access denied: You don't have permission to view this file",
		})
	}
	
	// Log preview request
	middleware.LogTimingEvent(c, "preview_request", map[string]interface{}{
		"filename": filename,
		"user_id": userID,
	})

	// Log for debugging
	fmt.Printf("Preview request for filename: %s by user: %s\n", filename, userID)

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

	// Note: Preview access no longer extends session to enforce strict 5-minute expiration
	// sessionID := c.Query("session_id")
	// Removed UpdateSessionAccess call to prevent timer extension

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
	// Log upload initialization
	middleware.LogTimingEvent(c, "upload_init_start", map[string]interface{}{
		"endpoint": "init_upload",
	})
	
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
	
	// Log upload session created
	middleware.LogTimingEvent(c, "upload_session_created", map[string]interface{}{
		"upload_id": session.ID,
		"filename": req.Filename,
		"file_size": req.FileSize,
		"total_chunks": session.TotalChunks,
		"chunk_size": session.ChunkSize,
	})

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
	
	// Log chunk upload start
	middleware.LogTimingEvent(c, "chunk_upload_start", map[string]interface{}{
		"upload_id": uploadID,
		"chunk_index": chunkIndexStr,
	})

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
	
	// Log chunk uploaded
	middleware.LogTimingEvent(c, "chunk_uploaded", map[string]interface{}{
		"upload_id": uploadID,
		"chunk_index": chunkIndex,
	})

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

	// Log assembly start
	middleware.LogTimingEvent(c, "assembly_start", map[string]interface{}{
		"upload_id": req.UploadID,
		"total_size": session.TotalSize,
	})
	
	// Assemble chunks into final file
	finalPath, err := vh.fileService.AssembleChunks(req.UploadID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to assemble file: %v", err),
		})
	}
	
	// Log assembly complete
	middleware.LogTimingEvent(c, "assembly_complete", map[string]interface{}{
		"upload_id": req.UploadID,
		"final_path": finalPath,
	})

	filename := filepath.Base(finalPath)

	// Create cleanup session for chunked upload with automatic cleanup of previous sessions
	sessionID := uuid.New().String()
	userID := c.Locals("userID").(string) // Use JWT user ID for session management
	vh.cleanupService.CreateSessionForUser(sessionID, filename, userID)

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Upload completed successfully",
		Data: map[string]interface{}{
			"session_id": sessionID,
			"filename":   filename,
			"size":       session.TotalSize,
			"uploaded":   true,
			"optimization": "fast_assembly_used",
		},
	})
}

// GetAssemblyProgress returns progress for an active assembly operation
func (vh *VideoHandler) GetAssemblyProgress(c *fiber.Ctx) error {
	uploadID := c.Params("upload_id")
	if uploadID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Upload ID parameter required",
		})
	}

	// This would need to be implemented in FileService to expose the assembly service
	// For now, return a placeholder response
	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Assembly progress endpoint (placeholder)",
		Data: map[string]interface{}{
			"upload_id": uploadID,
			"message":   "Assembly progress tracking available in optimized service",
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
