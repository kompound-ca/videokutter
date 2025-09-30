package services

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v4"
)

// JWTClaims represents the claims structure for our JWT tokens
type JWTClaims struct {
	UserID string `json:"user_id"`
	jwt.RegisteredClaims
}

// JWTService handles JWT token operations
type JWTService struct {
	secretKey []byte
}

// NewJWTService creates a new JWT service
func NewJWTService() *JWTService {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		panic("JWT_SECRET environment variable is required")
	}
	
	return &JWTService{
		secretKey: []byte(secret),
	}
}

// GenerateToken creates a JWT token based on browser fingerprint
func (js *JWTService) GenerateToken(clientIP, userAgent string) (string, string, error) {
	// Generate deterministic user ID from browser fingerprint
	userID := js.generateBrowserFingerprint(clientIP, userAgent)
	
	// Create claims with expiration time (2 hours for session)
	claims := JWTClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(2 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Subject:   "browser_session",
		},
	}

	// Create token with claims
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	
	// Generate signed token string
	tokenString, err := token.SignedString(js.secretKey)
	if err != nil {
		return "", "", err
	}

	return tokenString, userID, nil
}

// generateBrowserFingerprint creates a deterministic user ID from IP and User-Agent
func (js *JWTService) generateBrowserFingerprint(clientIP, userAgent string) string {
	// Create a hash of IP + User-Agent + secret (to prevent easy spoofing)
	hash := sha256.Sum256([]byte(clientIP + userAgent + string(js.secretKey)))
	return fmt.Sprintf("%x", hash)[:16] // Use first 16 chars as user ID
}

// ValidateToken validates a JWT token and returns the user ID
func (js *JWTService) ValidateToken(tokenString string) (string, error) {
	// Parse and validate token
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Validate signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("invalid signing method")
		}
		return js.secretKey, nil
	})

	if err != nil {
		return "", err
	}

	// Extract claims
	if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
		return claims.UserID, nil
	}

	return "", errors.New("invalid token claims")
}

// RefreshToken creates a new token for an existing user (extends session)
func (js *JWTService) RefreshToken(userID string) (string, error) {
	// Create claims with new expiration time
	claims := JWTClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Subject:   "anonymous_session",
		},
	}

	// Create token with claims
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	
	// Generate signed token string
	return token.SignedString(js.secretKey)
}