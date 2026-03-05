package main

import (
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const csp = "default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; " +
	"script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; " +
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
	"img-src 'self' data: blob:; " +
	"font-src 'self' https://fonts.gstatic.com; " +
	"media-src 'self' blob:; " +
	"worker-src 'self' blob:; " +
	"connect-src 'self' blob: data:;"

func main() {
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

	logRequests := os.Getenv("LOG_REQUESTS")
	if logRequests != "false" && logRequests != "none" {
		app.Use(logger.New())
	}
	app.Use(recover.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,OPTIONS",
		AllowHeaders: "Origin,Content-Type,Accept",
	}))
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "SAMEORIGIN")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Set("Content-Security-Policy", csp)
		return c.Next()
	})

	app.Static("/", "./static")

	// Redirect root to browser-cutter.html
	app.Get("/", func(c *fiber.Ctx) error {
		return c.SendFile("./static/browser-cutter.html")
	})

	// Configuration endpoint
	app.Get("/api/config", func(c *fiber.Ctx) error {
		logLevel := os.Getenv("LOG_LEVEL")
		if logLevel == "" {
			logLevel = "info"
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

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting minimal server on port %s", port)
	log.Printf("Access the browser-based video cutter at: http://localhost:%s", port)
	
	if err := app.Listen("0.0.0.0:" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}