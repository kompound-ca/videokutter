package main

import (
	"fmt"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

func main() {
	// Create Fiber app
	app := fiber.New(fiber.Config{
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
	logRequests := os.Getenv("LOG_REQUESTS")
	if logRequests != "false" && logRequests != "none" {
		app.Use(logger.New())
	}
	app.Use(recover.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,PUT,DELETE,OPTIONS",
		AllowHeaders: "Origin,Content-Type,Accept",
	}))

	// Serve static files
	app.Static("/", "./static")

	// Redirect root to browser-cutter.html
	app.Get("/", func(c *fiber.Ctx) error {
		return c.SendFile("./static/browser-cutter.html")
	})

	// Configuration endpoint
	app.Get("/api/config", func(c *fiber.Ctx) error {
		logLevel := os.Getenv("LOG_LEVEL")
		if logLevel == "" {
			logLevel = "info" // Default log level
		}
		return c.JSON(fiber.Map{
			"logLevel": logLevel,
		})
	})

	// Health check endpoint
	app.Get("/api/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status": "healthy",
			"version": "browser-only",
		})
	})

	// Get port from environment or default
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting minimal server on port %s", port)
	log.Printf("Access the browser-based video cutter at: http://localhost:%s", port)
	
	if err := app.Listen("0.0.0.0:" + port); err != nil {
		log.Fatal(fmt.Sprintf("Failed to start server: %v", err))
	}
}