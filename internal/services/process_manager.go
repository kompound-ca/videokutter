package services

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"sync"
	"syscall"
	"time"
)

// ProcessManager handles FFmpeg process concurrency and resource management
type ProcessManager struct {
	// Semaphore for heavy operations (transcoding, preview generation)
	heavyOpsSemaphore chan struct{}
	
	// Semaphore for light operations (stream copy, metadata extraction)
	lightOpsSemaphore chan struct{}
	
	// Mutex for tracking active processes
	processesLock sync.Mutex
	activeProcesses map[string]*ProcessInfo
	
	// Configuration
	maxHeavyOps int
	maxLightOps int
}

// ProcessInfo tracks information about running processes
type ProcessInfo struct {
	PID       int
	Command   string
	StartTime time.Time
	Type      string // "heavy" or "light"
}

// ProcessStats contains process statistics
type ProcessStats struct {
	ActiveHeavyOps int `json:"active_heavy_ops"`
	ActiveLightOps int `json:"active_light_ops"`
	TotalProcesses int `json:"total_processes"`
}

// NewProcessManager creates a new process manager with resource limits
func NewProcessManager() *ProcessManager {
	// For 2 vCPU Azure VM: limit concurrent operations
	maxHeavy := 1 // Only 1 concurrent heavy operation (transcoding/preview)
	maxLight := 3 // Up to 3 light operations (stream copy, metadata)
	
	return &ProcessManager{
		heavyOpsSemaphore: make(chan struct{}, maxHeavy),
		lightOpsSemaphore: make(chan struct{}, maxLight),
		activeProcesses:   make(map[string]*ProcessInfo),
		maxHeavyOps:      maxHeavy,
		maxLightOps:      maxLight,
	}
}

// ExecuteHeavyOperation executes a heavy FFmpeg operation with concurrency control
func (pm *ProcessManager) ExecuteHeavyOperation(ctx context.Context, cmd *exec.Cmd, operation string) error {
	// Acquire semaphore for heavy operations
	select {
	case pm.heavyOpsSemaphore <- struct{}{}:
		defer func() { <-pm.heavyOpsSemaphore }()
	case <-ctx.Done():
		return ctx.Err()
	}
	
	return pm.executeWithTracking(ctx, cmd, operation, "heavy")
}

// ExecuteLightOperation executes a light FFmpeg operation with concurrency control
func (pm *ProcessManager) ExecuteLightOperation(ctx context.Context, cmd *exec.Cmd, operation string) error {
	// Acquire semaphore for light operations
	select {
	case pm.lightOpsSemaphore <- struct{}{}:
		defer func() { <-pm.lightOpsSemaphore }()
	case <-ctx.Done():
		return ctx.Err()
	}
	
	return pm.executeWithTracking(ctx, cmd, operation, "light")
}

// executeWithTracking runs the command with process tracking and nice priority
func (pm *ProcessManager) executeWithTracking(ctx context.Context, cmd *exec.Cmd, operation, opType string) error {
	// Set lower process priority to keep system responsive
	if runtime.GOOS == "linux" {
		// Set nice value to 10 (lower priority)
		if cmd.SysProcAttr == nil {
			cmd.SysProcAttr = &syscall.SysProcAttr{}
		}
		// Note: Setting nice in SysProcAttr is platform-specific
		// For production, consider using ionice as well
	}
	
	// Start the process
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start %s operation: %w", operation, err)
	}
	
	// Track the process
	processID := fmt.Sprintf("%s_%d", operation, cmd.Process.Pid)
	processInfo := &ProcessInfo{
		PID:       cmd.Process.Pid,
		Command:   operation,
		StartTime: time.Now(),
		Type:      opType,
	}
	
	pm.processesLock.Lock()
	pm.activeProcesses[processID] = processInfo
	pm.processesLock.Unlock()
	
	fmt.Printf("Started %s operation (PID: %d, type: %s)\n", operation, cmd.Process.Pid, opType)
	
	// Wait for completion with context cancellation support
	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()
	
	var err error
	select {
	case err = <-done:
		// Process completed normally
	case <-ctx.Done():
		// Context cancelled, kill the process
		if cmd.Process != nil {
			cmd.Process.Kill()
			<-done // Wait for the process to actually exit
		}
		err = ctx.Err()
	}
	
	// Remove from tracking
	pm.processesLock.Lock()
	delete(pm.activeProcesses, processID)
	pm.processesLock.Unlock()
	
	elapsed := time.Since(processInfo.StartTime)
	if err != nil {
		fmt.Printf("Completed %s operation (PID: %d) in %v with error: %v\n", operation, processInfo.PID, elapsed, err)
	} else {
		fmt.Printf("Completed %s operation (PID: %d) in %v\n", operation, processInfo.PID, elapsed)
	}
	
	return err
}

// GetProcessStats returns current process statistics
func (pm *ProcessManager) GetProcessStats() ProcessStats {
	pm.processesLock.Lock()
	defer pm.processesLock.Unlock()
	
	stats := ProcessStats{
		TotalProcesses: len(pm.activeProcesses),
	}
	
	for _, proc := range pm.activeProcesses {
		switch proc.Type {
		case "heavy":
			stats.ActiveHeavyOps++
		case "light":
			stats.ActiveLightOps++
		}
	}
	
	return stats
}

// GetActiveProcesses returns information about currently running processes
func (pm *ProcessManager) GetActiveProcesses() map[string]*ProcessInfo {
	pm.processesLock.Lock()
	defer pm.processesLock.Unlock()
	
	// Return a copy to avoid race conditions
	result := make(map[string]*ProcessInfo)
	for k, v := range pm.activeProcesses {
		processCopy := *v
		result[k] = &processCopy
	}
	
	return result
}

// KillAllProcesses terminates all active FFmpeg processes (for graceful shutdown)
func (pm *ProcessManager) KillAllProcesses() {
	pm.processesLock.Lock()
	processes := make([]*ProcessInfo, 0, len(pm.activeProcesses))
	for _, proc := range pm.activeProcesses {
		processes = append(processes, proc)
	}
	pm.processesLock.Unlock()
	
	for _, proc := range processes {
		fmt.Printf("Terminating process %d (%s)\n", proc.PID, proc.Command)
		// Kill the process (this is platform-specific)
		if runtime.GOOS == "linux" {
			syscall.Kill(proc.PID, syscall.SIGTERM)
		}
	}
	
	// Give processes time to terminate gracefully
	time.Sleep(2 * time.Second)
	
	// Force kill any remaining processes
	pm.processesLock.Lock()
	for _, proc := range pm.activeProcesses {
		fmt.Printf("Force killing process %d (%s)\n", proc.PID, proc.Command)
		if runtime.GOOS == "linux" {
			syscall.Kill(proc.PID, syscall.SIGKILL)
		}
	}
	pm.processesLock.Unlock()
}

// IsSystemUnderLoad checks if the system is under heavy load
func (pm *ProcessManager) IsSystemUnderLoad() bool {
	stats := pm.GetProcessStats()
	
	// Consider system under load if:
	// - All heavy operation slots are taken
	// - More than 2 light operations are running
	return stats.ActiveHeavyOps >= pm.maxHeavyOps || stats.ActiveLightOps >= 2
}