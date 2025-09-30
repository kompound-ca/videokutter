package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/kompound-ca/videocutter/internal/handlers"
	"github.com/kompound-ca/videocutter/internal/middleware"
	"github.com/kompound-ca/videocutter/internal/services"
)

func main() {
	// Initialize services
	videoService := services.NewVideoService()
	fileService := services.NewFileService()
	cleanupService := services.NewCleanupService(fileService)
	jwtService := services.NewJWTService()
	
	// Perform startup cleanup to remove any leftover files from previous container runs
	// This is crucial since user sessions are lost during container restarts
	cleanupService.PerformStartupCleanup()

	// Create Fiber app
	app := fiber.New(fiber.Config{
		BodyLimit: 10 * 1024 * 1024 * 1024, // 10GB
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": err.Error(),
			})
		},
	})

	// Middleware
	// Enable HTTP request logging only if LOG_REQUESTS is not set to "false" or "none"
	logRequests := os.Getenv("LOG_REQUESTS")
	if logRequests != "false" && logRequests != "none" {
		app.Use(logger.New())
	}
	app.Use(recover.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,PUT,DELETE,OPTIONS",
		AllowHeaders: "Origin,Content-Type,Accept,Authorization",
	}))

	// JWT middleware for API protection
	app.Use(middleware.JWTMiddleware(jwtService))
	
	// Add timing middleware for upload performance tracking
	app.Use(middleware.TimingMiddleware())

	// Initialize handlers
	videoHandler := handlers.NewVideoHandler(videoService, fileService, cleanupService)
	cleanupHandler := handlers.NewCleanupHandler(cleanupService)
	sessionHandler := handlers.NewSessionHandler(jwtService)
	timingHandler := handlers.NewTimingHandler()

	// Static files
	app.Static("/", "./static")
	
	// Favicon route to prevent 404
	app.Get("/favicon.ico", func(c *fiber.Ctx) error {
		return c.SendStatus(204) // No content
	})

	// API routes
	api := app.Group("/api")
	
	// Session management endpoints (JWT)
	api.Post("/session/init", sessionHandler.InitSession)
	api.Post("/session/refresh", sessionHandler.RefreshSession)
	api.Get("/session/info", sessionHandler.GetSessionInfo)
	
	// Legacy single upload (kept for compatibility)
	api.Post("/upload", videoHandler.Upload)
	
	// Chunked upload endpoints
	api.Post("/upload/init", videoHandler.InitUpload)
	api.Post("/upload/chunk", videoHandler.UploadChunk)
	api.Get("/upload/status/:upload_id", videoHandler.GetUploadStatus)
	api.Post("/upload/complete", videoHandler.CompleteUpload)
	
	// Video processing endpoints
	api.Get("/metadata/:filename", videoHandler.GetMetadata)
	api.Post("/cut", videoHandler.Cut)
	api.Get("/download/:filename", videoHandler.Download)
	api.Get("/preview/:filename", videoHandler.Preview)
	api.Post("/generate-preview/:filename", videoHandler.GeneratePreview)
	
	// Cleanup endpoints
	api.Post("/cleanup/session", cleanupHandler.CleanupSession)
	api.Post("/cleanup/keepalive/:session_id", cleanupHandler.KeepAlive)
	api.Get("/cleanup/session/:session_id", cleanupHandler.GetSessionInfo)
	api.Get("/cleanup/session/:session_id/time-remaining", cleanupHandler.GetSessionTimeRemaining)
	api.Get("/cleanup/stats", cleanupHandler.GetStats)
	
	// Timing endpoints for performance analysis
	api.Get("/timing/:upload_id/timeline", timingHandler.GetTimeline)
	api.Get("/timing/:upload_id/summary", timingHandler.GetSummary)
	api.Get("/timing/:upload_id/report", timingHandler.GetFormattedReport)
	
	// Health check
	api.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	// Graceful shutdown
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-c
		log.Println("Gracefully shutting down...")
		cleanupService.Stop()
		_ = app.Shutdown()
	}()

	// Get port from environment or default
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Check if running in development mode
	isLocal := os.Getenv("COMPOSE_PROFILES") == "development"
	domain := os.Getenv("DOMAIN")
	if domain == "" {
		domain = "videocutter.local" // fallback to default
	}

	if isLocal {
		log.Printf("Running in DEVELOPMENT mode - direct access on port %s", port)
		log.Printf("Access the application at: http://localhost:%s", port)
	} else {
		log.Printf("Running in PRODUCTION mode - server on port %s (behind nginx/SSL)", port)
		log.Printf("Access the application at: https://%s", domain)
	}
	if err := app.Listen("0.0.0.0:" + port); err != nil {
		log.Fatal(fmt.Sprintf("Failed to start server: %v", err))
	}
}