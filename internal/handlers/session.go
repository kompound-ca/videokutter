package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/kompound-ca/videocutter/internal/services"
)

// SessionHandler handles JWT session management
type SessionHandler struct {
	jwtService *services.JWTService
}

// NewSessionHandler creates a new session handler
func NewSessionHandler(jwtService *services.JWTService) *SessionHandler {
	return &SessionHandler{
		jwtService: jwtService,
	}
}

// InitSession generates a new JWT token for browser session
func (sh *SessionHandler) InitSession(c *fiber.Ctx) error {
	// Get client info for fingerprinting
	clientIP := c.IP()
	userAgent := c.Get("User-Agent")
	
	// Generate JWT token based on browser fingerprint
	token, userID, err := sh.jwtService.GenerateToken(clientIP, userAgent)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"success": false,
			"error":   "Failed to generate session token",
			"message": err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Session initialized successfully",
		"data": fiber.Map{
			"token":   token,
			"user_id": userID,
			"type":    "Bearer",
			"expires_in": 7200, // 2 hours in seconds
		},
	})
}

// RefreshSession extends an existing session
func (sh *SessionHandler) RefreshSession(c *fiber.Ctx) error {
	// Get user ID from JWT middleware
	userID := c.Locals("userID").(string)
	
	// Generate new token for existing user
	token, err := sh.jwtService.RefreshToken(userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"success": false,
			"error":   "Failed to refresh session token",
			"message": err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Session refreshed successfully",
		"data": fiber.Map{
			"token":   token,
			"user_id": userID,
			"type":    "Bearer",
			"expires_in": 7200, // 2 hours in seconds
		},
	})
}

// GetSessionInfo returns current session information
func (sh *SessionHandler) GetSessionInfo(c *fiber.Ctx) error {
	// Get user ID from JWT middleware
	userID := c.Locals("userID").(string)
	token := c.Locals("token").(string)

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Session information retrieved",
		"data": fiber.Map{
			"user_id": userID,
			"token_present": len(token) > 0,
			"authenticated": true,
		},
	})
}