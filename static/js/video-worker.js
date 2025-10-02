// Web Worker for heavy video operations
self.addEventListener('message', async function(e) {
    const { type, data } = e.data;
    
    try {
        switch (type) {
            case 'READ_FILE':
                await handleFileRead(data);
                break;
                
            case 'PROCESS_VIDEO_DATA':
                await handleVideoProcessing(data);
                break;
                
            case 'CREATE_BLOB_URL':
                await handleBlobCreation(data);
                break;
                
            default:
                self.postMessage({ 
                    type: 'ERROR', 
                    error: 'Unknown operation type' 
                });
        }
    } catch (error) {
        self.postMessage({ 
            type: 'ERROR', 
            error: error.message 
        });
    }
});

async function handleFileRead(data) {
    const { file, id } = data;
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        
        // Send progress updates
        self.postMessage({
            type: 'PROGRESS',
            id: id,
            progress: 100
        });
        
        // Send the result
        self.postMessage({
            type: 'FILE_READ_COMPLETE',
            id: id,
            data: arrayBuffer,
            size: arrayBuffer.byteLength
        }, [arrayBuffer]); // Transfer ownership for better performance
        
    } catch (error) {
        self.postMessage({
            type: 'FILE_READ_ERROR',
            id: id,
            error: error.message
        });
    }
}

async function handleVideoProcessing(data) {
    const { arrayBuffer, operation, params } = data;
    
    // Simulate processing
    self.postMessage({
        type: 'PROCESSING_COMPLETE',
        data: arrayBuffer
    }, [arrayBuffer]);
}

async function handleBlobCreation(data) {
    const { arrayBuffer, type, id } = data;
    
    try {
        const blob = new Blob([arrayBuffer], { type: type });
        const url = URL.createObjectURL(blob);
        
        self.postMessage({
            type: 'BLOB_URL_CREATED',
            id: id,
            url: url
        });
    } catch (error) {
        self.postMessage({
            type: 'BLOB_CREATION_ERROR',
            id: id,
            error: error.message
        });
    }
}