package middleware

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

// TimingEvent represents a single timing measurement
type TimingEvent struct {
	UploadID  string    `json:"upload_id"`
	Event     string    `json:"event"`
	Timestamp time.Time `json:"timestamp"`
	Duration  int64     `json:"duration_ms,omitempty"` // Duration since last event in milliseconds
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// TimingTracker manages timing events for uploads
type TimingTracker struct {
	events map[string][]TimingEvent
	mutex  sync.RWMutex
	logger *json.Encoder
	enableLogging bool
}

var globalTimingTracker *TimingTracker
var trackerOnce sync.Once

// GetTimingTracker returns the singleton timing tracker
func GetTimingTracker() *TimingTracker {
	trackerOnce.Do(func() {
		// Check if logging should be enabled based on LOG_LEVEL
		logLevel := strings.ToLower(os.Getenv("LOG_LEVEL"))
		enableLogging := logLevel == "debug" || logLevel == "info" || logLevel == ""
		
		globalTimingTracker = &TimingTracker{
			events: make(map[string][]TimingEvent),
			logger: json.NewEncoder(os.Stdout),
			enableLogging: enableLogging,
		}
	})
	return globalTimingTracker
}

// LogEvent records a timing event for an upload
func (tt *TimingTracker) LogEvent(uploadID, event string, metadata map[string]interface{}) {
	if uploadID == "" {
		return // Skip if no upload ID
	}

	now := time.Now()
	
	tt.mutex.Lock()
	defer tt.mutex.Unlock()

	// Get previous events for this upload
	events := tt.events[uploadID]
	
	// Calculate duration since last event
	var duration int64
	if len(events) > 0 {
		duration = now.Sub(events[len(events)-1].Timestamp).Milliseconds()
	}

	// Create new event
	timingEvent := TimingEvent{
		UploadID:  uploadID,
		Event:     event,
		Timestamp: now,
		Duration:  duration,
		Metadata:  metadata,
	}

	// Add to events list
	tt.events[uploadID] = append(events, timingEvent)
	
	// Log as JSON only if logging is enabled (respects LOG_LEVEL)
	if tt.enableLogging {
		tt.logger.Encode(timingEvent)
	}

	// Keep only recent events to avoid memory issues (last 50 events per upload)
	if len(tt.events[uploadID]) > 50 {
		tt.events[uploadID] = tt.events[uploadID][len(tt.events[uploadID])-50:]
	}
	
	// Clean up old uploads (keep only last 100 uploads)
	if len(tt.events) > 100 {
		// Find oldest upload and remove it
		var oldestTime time.Time = now
		var oldestID string
		for id, eventList := range tt.events {
			if len(eventList) > 0 && eventList[0].Timestamp.Before(oldestTime) {
				oldestTime = eventList[0].Timestamp
				oldestID = id
			}
		}
		if oldestID != "" {
			delete(tt.events, oldestID)
		}
	}
}

// GetTimeline returns the timeline for a specific upload
func (tt *TimingTracker) GetTimeline(uploadID string) []TimingEvent {
	tt.mutex.RLock()
	defer tt.mutex.RUnlock()
	
	events := tt.events[uploadID]
	if events == nil {
		return []TimingEvent{}
	}
	
	// Return a copy to avoid race conditions
	result := make([]TimingEvent, len(events))
	copy(result, events)
	return result
}

// GetSummary returns a summary of timing for an upload
func (tt *TimingTracker) GetSummary(uploadID string) map[string]interface{} {
	events := tt.GetTimeline(uploadID)
	if len(events) == 0 {
		return map[string]interface{}{"error": "No events found"}
	}

	summary := map[string]interface{}{
		"upload_id": uploadID,
		"start_time": events[0].Timestamp,
		"events": make([]map[string]interface{}, 0),
		"total_duration_ms": 0,
	}

	for _, event := range events {
		eventSummary := map[string]interface{}{
			"event": event.Event,
			"timestamp": event.Timestamp,
			"duration_from_previous_ms": event.Duration,
		}
		
		if event.Metadata != nil {
			eventSummary["metadata"] = event.Metadata
		}
		
		summary["events"] = append(summary["events"].([]map[string]interface{}), eventSummary)
	}
	
	if len(events) > 0 {
		summary["end_time"] = events[len(events)-1].Timestamp
		summary["total_duration_ms"] = events[len(events)-1].Timestamp.Sub(events[0].Timestamp).Milliseconds()
	}

	return summary
}

// TimingMiddleware injects upload timing functionality into requests
func TimingMiddleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		// Extract upload ID from various sources
		uploadID := c.Params("upload_id")
		if uploadID == "" {
			uploadID = c.Query("upload_id")
		}
		if uploadID == "" {
			uploadID = c.FormValue("upload_id")
		}
		if uploadID == "" {
			// Try to get from request body for JSON requests
			var body map[string]interface{}
			if c.Get("Content-Type") == "application/json" {
				if err := c.BodyParser(&body); err == nil {
					if id, ok := body["upload_id"].(string); ok {
						uploadID = id
					}
				}
			}
		}

		// Store upload ID in context for handlers to use
		if uploadID != "" {
			c.Locals("upload_id", uploadID)
			c.Locals("timing_tracker", GetTimingTracker())
		}

		return c.Next()
	}
}

// LogTimingEvent is a helper function for handlers to log timing events
func LogTimingEvent(c *fiber.Ctx, event string, metadata map[string]interface{}) {
	if uploadID, ok := c.Locals("upload_id").(string); ok && uploadID != "" {
		if tracker, ok := c.Locals("timing_tracker").(*TimingTracker); ok {
			tracker.LogEvent(uploadID, event, metadata)
		}
	}
}

// FormatDuration formats a duration in milliseconds to human-readable format
func FormatDuration(ms int64) string {
	if ms < 1000 {
		return fmt.Sprintf("%dms", ms)
	} else if ms < 60000 {
		return fmt.Sprintf("%.1fs", float64(ms)/1000.0)
	} else {
		return fmt.Sprintf("%.1fm", float64(ms)/60000.0)
	}
}
