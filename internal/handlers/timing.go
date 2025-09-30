package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/kompound-ca/videocutter/internal/middleware"
	"github.com/kompound-ca/videocutter/internal/models"
)

type TimingHandler struct {
	timingTracker *middleware.TimingTracker
}

func NewTimingHandler() *TimingHandler {
	return &TimingHandler{
		timingTracker: middleware.GetTimingTracker(),
	}
}

// GetTimeline returns the timing timeline for a specific upload
func (th *TimingHandler) GetTimeline(c *fiber.Ctx) error {
	uploadID := c.Params("upload_id")
	if uploadID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Upload ID parameter required",
		})
	}

	timeline := th.timingTracker.GetTimeline(uploadID)
	
	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Timeline retrieved successfully",
		Data: map[string]interface{}{
			"upload_id": uploadID,
			"events":    timeline,
		},
	})
}

// GetSummary returns a summary of timing data for an upload
func (th *TimingHandler) GetSummary(c *fiber.Ctx) error {
	uploadID := c.Params("upload_id")
	if uploadID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Upload ID parameter required",
		})
	}

	summary := th.timingTracker.GetSummary(uploadID)
	
	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Summary retrieved successfully",
		Data:    summary,
	})
}

// GetFormattedReport returns a human-readable timing report
func (th *TimingHandler) GetFormattedReport(c *fiber.Ctx) error {
	uploadID := c.Params("upload_id")
	if uploadID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{
			Success: false,
			Message: "Upload ID parameter required",
		})
	}

	timeline := th.timingTracker.GetTimeline(uploadID)
	if len(timeline) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(models.APIResponse{
			Success: false,
			Message: "No timing data found for upload ID",
		})
	}

	// Format as human-readable report
	report := []map[string]interface{}{}
	
	for i, event := range timeline {
		eventData := map[string]interface{}{
			"step":        i + 1,
			"event":       event.Event,
			"timestamp":   event.Timestamp.Format("15:04:05.000"),
			"duration":    middleware.FormatDuration(event.Duration),
		}
		
		if event.Metadata != nil {
			eventData["details"] = event.Metadata
		}
		
		report = append(report, eventData)
	}
	
	// Calculate total time
	totalDuration := timeline[len(timeline)-1].Timestamp.Sub(timeline[0].Timestamp)
	
	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Formatted report generated successfully",
		Data: map[string]interface{}{
			"upload_id":         uploadID,
			"total_duration":    middleware.FormatDuration(totalDuration.Milliseconds()),
			"total_events":      len(timeline),
			"start_time":        timeline[0].Timestamp.Format("15:04:05.000"),
			"end_time":          timeline[len(timeline)-1].Timestamp.Format("15:04:05.000"),
			"events":            report,
		},
	})
}