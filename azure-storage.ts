// Used by index.ts for copying images into Azure Storage blob containers
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import * as dotenv from 'dotenv';
dotenv.config();

const containerName = 'countdownimages';

let blobServiceClient: BlobServiceClient;
let containerClient: ContainerClient;

// Check if .env contains azure storage connection string
const AZURE_STORAGE_CONSTRING = process.env.AZURE_STORAGE_CONSTRING;
if (!AZURE_STORAGE_CONSTRING) {
  throw Error('Azure Storage Connection String AZURE_STORAGE_CONSTRING not found in .env');
}

try {
  // Connect with connection string
  blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONSTRING);

  // Create ContainerClient for container 'countdownimages'
  containerClient = blobServiceClient.getContainerClient(containerName);
} catch (error) {
  throw Error('Azure Storage Connection String invalid');
}

export default async function uploadImageToAzureStorage(id: string, hiresImageUrl: string) {
  try {
    // Use id as the filename
    const blobFilename = id + '.jpg';
    const blobClient = containerClient.getBlockBlobClient(blobFilename);
    const imageExists = await blobClient.exists();

    // If image doesn't already exist on azure storage, copy over
    if (!imageExists) {
      // Atttempt to upload image to azure
      const uploadBlobResponse = await blobClient.syncCopyFromURL(hiresImageUrl);

      if (uploadBlobResponse.copyStatus === 'success') {
        // console.log('Image new upload: ' + blobFilename + ' uploaded successfully');
        return true;
      } else {
        // Image upload can fail if the url was invalid
        console.log('Image upload failed: ' + hiresImageUrl);
        return false;
      }
    } else {
      // console.log('Image already exists: ' + blobFilename);
      return false;
    }
  } catch {
    // Catch other errors and return false for an unsuccessful upload
    return false;
  }
}
