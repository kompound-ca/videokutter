package models

import "time"

// ChunkUploadRequest represents a chunk upload request
type ChunkUploadRequest struct {
	UploadID     string `json:"upload_id" form:"upload_id"`
	ChunkIndex   int    `json:"chunk_index" form:"chunk_index"`
	TotalChunks  int    `json:"total_chunks" form:"total_chunks"`
	ChunkSize    int64  `json:"chunk_size" form:"chunk_size"`
	TotalSize    int64  `json:"total_size" form:"total_size"`
	Filename     string `json:"filename" form:"filename"`
}

// ChunkUploadResponse represents a chunk upload response
type ChunkUploadResponse struct {
	UploadID     string `json:"upload_id"`
	ChunkIndex   int    `json:"chunk_index"`
	Uploaded     bool   `json:"uploaded"`
	NextChunk    int    `json:"next_chunk,omitempty"`
}

// InitUploadRequest represents an upload initialization request
type InitUploadRequest struct {
	Filename  string `json:"filename"`
	FileSize  int64  `json:"file_size"`
	ChunkSize int64  `json:"chunk_size"`
}

// InitUploadResponse represents an upload initialization response
type InitUploadResponse struct {
	UploadID    string `json:"upload_id"`
	ChunkSize   int64  `json:"chunk_size"`
	TotalChunks int    `json:"total_chunks"`
}

// CompleteUploadRequest represents an upload completion request
type CompleteUploadRequest struct {
	UploadID string `json:"upload_id"`
}

// UploadSession represents an active upload session
type UploadSession struct {
	ID            string    `json:"id"`
	Filename      string    `json:"filename"`
	OriginalName  string    `json:"original_name"`
	TotalSize     int64     `json:"total_size"`
	ChunkSize     int64     `json:"chunk_size"`
	TotalChunks   int       `json:"total_chunks"`
	UploadedChunks map[int]bool `json:"uploaded_chunks"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}