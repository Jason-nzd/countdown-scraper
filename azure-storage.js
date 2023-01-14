// Used by index.js for storing images into Azure Storage blob containers
import { BlobServiceClient } from '@azure/storage-blob';
import * as dotenv from 'dotenv';
dotenv.config();

// Create the BlobServiceClient object with connection string from .env
const AZURE_STORAGE_CONSTRING = process.env.AZURE_STORAGE_CONSTRING;
if (!AZURE_STORAGE_CONSTRING) {
  throw Error('Azure Storage Connection string not found');
}
const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONSTRING);

// Create ContainerClient for container 'countdownimages'
const containerClient = blobServiceClient.getContainerClient('countdownimages');

export default async function uploadImageToAzureStorage(id, hiresImageUrl, originalImageUrl) {
  // Use id as the filename
  const blobFilename = id + '.jpg';
  const blobClient = containerClient.getBlobClient(blobFilename);

  // If image doesn't already exist on azure, copy over
  if (!blobClient.exists()) {
    const uploadBlobResponse = await blobClient.syncCopyFromURL(hiresImageUrl);

    if (uploadBlobResponse.copyStatus === 'success') {
      console.log('Image new upload: ' + blobFilename + ' uploaded successfully');
      return true;
    } else {
      console.log('Image upload failed: ' + hiresImageUrl);
      return false;
    }
  } else {
    //console.log('Image already exists: ' + blobFilename);
    return false;
  }
}
