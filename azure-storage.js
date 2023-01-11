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

export default async function uploadImageToAzureStorage(id, imageUrl) {
  // Use id as the filename
  const blobFilename = id + '.jpg';
  const blobClient = containerClient.getBlobClient(blobFilename);

  console.log('Attempting upload for id=' + id + ' \t url: ' + imageUrl.slice(29));
  // If image doesn't already exist on azure, copy over
  if (!blobClient.exists()) {
    const uploadBlobResponse = await blobClient.syncCopyFromURL(imageUrl);

    if (uploadBlobResponse.copyStatus === 'success') {
      console.log('New image ' + blobFilename + ' uploaded successfully');
    } else console.log(imageUrl + ' --- failed ---');
  } else console.log(blobFilename + ' already exists');
}
