package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/kompound-ca/videocutter/internal/services"
)

// CleanupHandler handles cleanup-related HTTP requests
type CleanupHandler struct {
	cleanupService *services.CleanupService
}

// NewCleanupHandler creates a new cleanup handler
func NewCleanupHandler(cleanupService *services.CleanupService) *CleanupHandler {
	return &CleanupHandler{
		cleanupService: cleanupService,
	}
}

// CleanupSessionRequest represents a session cleanup request
type CleanupSessionRequest struct {
	SessionID string `json:"session_id" form:"session_id"`
}

// CleanupSession handles immediate cleanup of a specific session
func (h *CleanupHandler) CleanupSession(c *fiber.Ctx) error {
	var req CleanupSessionRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error":   "Invalid request format",
		})
	}

	if req.SessionID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error":   "Session ID is required",
		})
	}

	// Check if session exists
	if _, exists := h.cleanupService.GetSession(req.SessionID); !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"success": false,
			"error":   "Session not found",
		})
	}

	// Clean up the session
	if err := h.cleanupService.CleanupSession(req.SessionID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"success": false,
			"error":   "Failed to cleanup session: " + err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Session cleaned up successfully",
	})
}

// KeepAlive updates the last access time for a session to prevent timeout
func (h *CleanupHandler) KeepAlive(c *fiber.Ctx) error {
	sessionID := c.Params("session_id")
	if sessionID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error":   "Session ID is required",
		})
	}

	// Check if session exists
	if _, exists := h.cleanupService.GetSession(sessionID); !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"success": false,
			"error":   "Session not found",
		})
	}

	// Note: Keep-alive no longer extends session due to strict timing policy
	// Sessions expire exactly 5 minutes after upload/cut regardless of activity
	
	return c.JSON(fiber.Map{
		"success": true,
		"message": "Session is active",
	})
}

// GetSessionInfo returns information about a session
func (h *CleanupHandler) GetSessionInfo(c *fiber.Ctx) error {
	sessionID := c.Params("session_id")
	if sessionID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error":   "Session ID is required",
		})
	}

	// Get session info
	session, exists := h.cleanupService.GetSession(sessionID)
	if !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"success": false,
			"error":   "Session not found",
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    session,
	})
}

// GetSessionTimeRemaining returns remaining time before session expires
func (h *CleanupHandler) GetSessionTimeRemaining(c *fiber.Ctx) error {
	sessionID := c.Params("session_id")
	if sessionID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"error":   "Session ID is required",
		})
	}

	// Get session info
	session, exists := h.cleanupService.GetSession(sessionID)
	if !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"success": false,
			"error":   "Session not found",
		})
	}

	// Calculate remaining time based on strict timing rules:
	// - If processed: 5 minutes from processing time
	// - If only uploaded: 5 minutes from creation time
	maxFileAge := 5 * 60 // 5 minutes in seconds
	var elapsedSeconds int
	var referenceTime time.Time
	var phase string
	
	if session.IsDownloadReady && !session.ProcessedAt.IsZero() {
		// Session has processed file - calculate from processing time
		referenceTime = session.ProcessedAt
		phase = "download"
		elapsedSeconds = int(time.Since(session.ProcessedAt).Seconds())
	} else {
		// Session only has uploaded file - calculate from creation time
		referenceTime = session.CreatedAt
		phase = "cut"
		elapsedSeconds = int(time.Since(session.CreatedAt).Seconds())
	}
	
	remainingSeconds := maxFileAge - elapsedSeconds
	if remainingSeconds < 0 {
		remainingSeconds = 0
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"remaining_seconds": remainingSeconds,
			"remaining_minutes": remainingSeconds / 60,
			"reference_time":    referenceTime,
			"phase":             phase, // "cut" or "download"
			"is_expired":        remainingSeconds <= 0,
			"created_at":        session.CreatedAt,
			"processed_at":      session.ProcessedAt,
		},
	})
}

// GetStats returns cleanup service statistics
func (h *CleanupHandler) GetStats(c *fiber.Ctx) error {
	stats := h.cleanupService.GetSessionStats()
	
	return c.JSON(fiber.Map{
		"success": true,
		"data":    stats,
	})
}
