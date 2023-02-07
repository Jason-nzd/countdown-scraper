// Used by index.ts for copying images into Azure Storage blob containers
import { BlobServiceClient, ContainerClient, RestError } from '@azure/storage-blob';
import * as dotenv from 'dotenv';
dotenv.config();

const containerName = 'countdownimages';

let blobServiceClient: BlobServiceClient;
let containerClient: ContainerClient;
let transparentImageClient: ContainerClient;

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
  transparentImageClient = blobServiceClient.getContainerClient('transparent-cd-images');
} catch (error) {
  throw Error('Azure Storage Connection String invalid');
}

export default async function uploadImageToAzureStorage(
  id: string,
  url: string,
  productName: string
) {
  try {
    // Use id as the filename
    const blobFilename = id + '.jpg';

    // First check CDN if file already exists, this saves on GET calls to Azure Storage
    // const existingCDNImageURL = 'https://d1hhwouzawkav1.cloudfront.net/' + blobFilename;
    // const cdnResponse = await fetch(existingCDNImageURL);
    // if (cdnResponse.ok) return false;
    // console.log(blobFilename + ' not on CDN');

    // Check if file already exists on Azure Storage, this saves on PUT calls
    const blobClient = containerClient.getBlockBlobClient(blobFilename);
    const transparentImageBlob = transparentImageClient.getBlobClient(blobFilename);
    const transparentImageExists = await transparentImageBlob.exists();
    if (transparentImageExists) return false;

    // If image doesn't already exist on azure storage, copy over
    if (!transparentImageExists) {
      // Atttempt to upload image to azure
      const uploadBlobResponse = await blobClient.syncCopyFromURL(url);

      if (uploadBlobResponse.copyStatus === 'success') {
        console.log('Image: ' + blobFilename + ' for ' + productName + ' uploaded');
        return true;
      } else {
        // Image upload can fail if the url was invalid
        console.log('Image upload failed: ' + url + ' - status: ' + uploadBlobResponse.copyStatus);
        return false;
      }
    }
  } catch (e) {
    // RestError often occurs when the original image is missing
    if ((e as Error).name === 'RestError') {
      console.log('URL unavailable to copy: ' + url);
    } else {
      // Print the full error for other errors
      console.log(e);
    }
    // Return false for an unsuccessful upload
    return false;
  }
}
