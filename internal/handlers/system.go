package handlers

import (
	"runtime"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/kompound-ca/videocutter/internal/models"
	"github.com/kompound-ca/videocutter/internal/services"
)

// SystemHandler handles system monitoring and resource tracking
type SystemHandler struct {
	processManager *services.ProcessManager
}

// SystemStats contains system resource information
type SystemStats struct {
	ProcessStats    services.ProcessStats `json:"process_stats"`
	MemoryStats     MemoryStats          `json:"memory_stats"`
	GoRuntimeStats  GoRuntimeStats       `json:"go_runtime_stats"`
	SystemLoad      SystemLoad           `json:"system_load"`
	Uptime          string               `json:"uptime"`
	Timestamp       time.Time            `json:"timestamp"`
}

// MemoryStats contains memory usage information
type MemoryStats struct {
	AllocMB      uint64  `json:"alloc_mb"`
	TotalAllocMB uint64  `json:"total_alloc_mb"`
	SysMB        uint64  `json:"sys_mb"`
	NumGC        uint32  `json:"num_gc"`
	MemoryUsage  float64 `json:"memory_usage_percent"`
}

// GoRuntimeStats contains Go runtime statistics
type GoRuntimeStats struct {
	NumGoroutine int `json:"num_goroutine"`
	NumCPU       int `json:"num_cpu"`
	GOMAXPROCS   int `json:"gomaxprocs"`
}

// SystemLoad indicates current system stress level
type SystemLoad struct {
	Level       string `json:"level"` // "low", "medium", "high"
	UnderLoad   bool   `json:"under_load"`
	Description string `json:"description"`
}

var startTime = time.Now()

// NewSystemHandler creates a new system monitoring handler
func NewSystemHandler(processManager *services.ProcessManager) *SystemHandler {
	return &SystemHandler{
		processManager: processManager,
	}
}

// GetSystemStats returns comprehensive system statistics
func (sh *SystemHandler) GetSystemStats(c *fiber.Ctx) error {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	processStats := sh.processManager.GetProcessStats()
	
	// Calculate memory usage percentage (rough estimate)
	memUsagePercent := float64(m.Alloc) / float64(m.Sys) * 100
	if memUsagePercent > 100 {
		memUsagePercent = 100
	}

	// Determine system load level
	systemLoad := sh.calculateSystemLoad(processStats, m)

	stats := SystemStats{
		ProcessStats: processStats,
		MemoryStats: MemoryStats{
			AllocMB:      bToMb(m.Alloc),
			TotalAllocMB: bToMb(m.TotalAlloc),
			SysMB:        bToMb(m.Sys),
			NumGC:        m.NumGC,
			MemoryUsage:  memUsagePercent,
		},
		GoRuntimeStats: GoRuntimeStats{
			NumGoroutine: runtime.NumGoroutine(),
			NumCPU:       runtime.NumCPU(),
			GOMAXPROCS:   runtime.GOMAXPROCS(0),
		},
		SystemLoad: systemLoad,
		Uptime:     time.Since(startTime).String(),
		Timestamp:  time.Now(),
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "System statistics retrieved",
		Data:    stats,
	})
}

// GetProcessList returns currently active FFmpeg processes
func (sh *SystemHandler) GetProcessList(c *fiber.Ctx) error {
	processes := sh.processManager.GetActiveProcesses()

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Active processes retrieved",
		Data:    processes,
	})
}

// GetHealthCheck returns a simple health status with resource awareness
func (sh *SystemHandler) GetHealthCheck(c *fiber.Ctx) error {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	processStats := sh.processManager.GetProcessStats()
	isUnderLoad := sh.processManager.IsSystemUnderLoad()
	
	status := "ok"
	if isUnderLoad {
		status = "under_load"
	}
	
	// Check for critical resource conditions
	memUsageMB := bToMb(m.Alloc)
	if memUsageMB > 3000 { // Over 3GB on 4GB system
		status = "critical_memory"
	}
	
	if processStats.TotalProcesses > 10 {
		status = "too_many_processes"
	}

	healthData := map[string]interface{}{
		"status":           status,
		"memory_alloc_mb":  memUsageMB,
		"active_processes": processStats.TotalProcesses,
		"heavy_ops":        processStats.ActiveHeavyOps,
		"light_ops":        processStats.ActiveLightOps,
		"under_load":       isUnderLoad,
		"uptime":          time.Since(startTime).String(),
	}

	statusCode := fiber.StatusOK
	if status != "ok" {
		statusCode = fiber.StatusServiceUnavailable
	}

	return c.Status(statusCode).JSON(models.APIResponse{
		Success: status == "ok",
		Message: "Health check completed",
		Data:    healthData,
	})
}

// calculateSystemLoad determines current system stress level
func (sh *SystemHandler) calculateSystemLoad(processStats services.ProcessStats, memStats runtime.MemStats) SystemLoad {
	load := SystemLoad{
		Level:     "low",
		UnderLoad: false,
	}

	memUsageMB := bToMb(memStats.Alloc)
	
	// Determine load level based on multiple factors
	if processStats.ActiveHeavyOps > 0 || memUsageMB > 2000 {
		load.Level = "medium"
		load.UnderLoad = true
		load.Description = "System processing video operations"
	}
	
	if processStats.ActiveHeavyOps >= 1 && processStats.ActiveLightOps >= 2 {
		load.Level = "high"
		load.UnderLoad = true
		load.Description = "High concurrent processing load"
	}
	
	if memUsageMB > 3000 {
		load.Level = "high"
		load.UnderLoad = true
		load.Description = "High memory usage detected"
	}
	
	if processStats.TotalProcesses > 8 {
		load.Level = "high"
		load.UnderLoad = true
		load.Description = "Many active processes"
	}

	if load.Level == "low" {
		load.Description = "System running smoothly"
	}

	return load
}

// bToMb converts bytes to megabytes
func bToMb(b uint64) uint64 {
	return b / 1024 / 1024
}