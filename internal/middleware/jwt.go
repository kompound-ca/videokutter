package middleware

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/kompound-ca/videocutter/internal/services"
)

// JWTMiddleware creates a middleware that validates JWT tokens
func JWTMiddleware(jwtService *services.JWTService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// Skip JWT validation for certain endpoints
		path := c.Path()
		
		// Allow unauthenticated access to:
		// - Static files and favicon
		// - Health check
		// - Session initialization endpoint
		if !strings.HasPrefix(path, "/api") || 
		   path == "/api/health" || 
		   path == "/api/session/init" {
			return c.Next()
		}

        var tokenString string
        
        // For preview and download endpoints, allow token via query parameter
        // since HTML video elements and download links can't send Authorization headers
        if strings.HasPrefix(path, "/api/preview/") || strings.HasPrefix(path, "/api/download/") {
            tokenString = c.Query("token")
            if tokenString == "" {
                return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
                    "success": false,
                    "error":   "Token required",
                    "message": "JWT token is required as 'token' query parameter",
                })
            }
        } else {
            // For other API endpoints, require Authorization header
            authHeader := c.Get("Authorization")
            if authHeader == "" {
                return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
                    "success": false,
                    "error":   "Authorization header required",
                    "message": "Please include a valid JWT token in the Authorization header",
                })
            }

            // Check Bearer token format
            const bearerPrefix = "Bearer "
            if !strings.HasPrefix(authHeader, bearerPrefix) {
                return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
                    "success": false,
                    "error":   "Invalid authorization format",
                    "message": "Authorization header must be in format 'Bearer <token>'",
                })
            }

            // Extract token
            tokenString = strings.TrimPrefix(authHeader, bearerPrefix)
            if tokenString == "" {
                return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
                    "success": false,
                    "error":   "Token missing",
                    "message": "JWT token is required",
                })
            }
        }

		// Validate token
		userID, err := jwtService.ValidateToken(tokenString)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"success": false,
				"error":   "Invalid token",
				"message": err.Error(),
			})
		}

		// Store user ID in context for use by handlers
		c.Locals("userID", userID)
		c.Locals("token", tokenString)

		return c.Next()
	}
}