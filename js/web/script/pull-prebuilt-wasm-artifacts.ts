// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

//
// This script is used to download WebAssembly build artifacts from CI pipeline.
//
// The goal of this script is to save time for ORT Web developers. For most TypeScript tasks, there is no change in the
// WebAssembly side, so there is no need to rebuild WebAssembly.
//
// It performs the following operations:
// 1. query build ID for latest successful build on main branch or the specified one from command line argument
// 2. query download URL of build artifacts
// 3. download and unzip the files to folders
//

import fs from 'fs';
import { bootstrap as globalAgentBootstrap } from 'global-agent';
import https from 'https';
import jszip from 'jszip';
import path from 'path';

const HELP_MESSAGE = `
pull-prebuilt-wasm-artifacts

Usage:
  npm run pull:wasm [config] [buildID] [help|h]

  node ./pull-prebuilt-wasm-artifacts [config] [buildID] [help|h]


  config       optional, "release"(default) or "debug"
  buildID      optional, if not specified, use latest main branch, otherwise a number for a specified build ID
  help|h       print this message and exit
`;

const argv = process.argv.slice(2);

if (
  argv.indexOf('--help') !== -1 ||
  argv.indexOf('-h') !== -1 ||
  argv.indexOf('help') !== -1 ||
  argv.indexOf('h') !== -1
) {
  console.log(HELP_MESSAGE);
  process.exit();
}

const arg0isConfig = argv[0] === 'debug' || argv[0] === 'release';
const arg0isInteger = !arg0isConfig && !isNaN(parseInt(argv[0], 10));
const config = arg0isConfig ? argv[0] : 'release';
const buildId = arg0isInteger ? argv[0] : (argv[1] ?? '');

const folderName = config === 'release' ? 'Release_wasm' : 'Debug_wasm';

function downloadJson(url: string, onSuccess: (data: any) => void) {
  https.get(url, (res) => {
    const { statusCode } = res;
    const contentType = res.headers['content-type'];

    if (statusCode !== 200) {
      throw new Error(`Failed to download build list. HTTP status code = ${statusCode}`);
    }
    if (!contentType || !/^application\/json/.test(contentType)) {
      throw new Error(`unexpected content type: ${contentType}`);
    }
    res.setEncoding('utf8');
    let rawData = '';
    res.on('data', (chunk) => {
      rawData += chunk;
    });
    res.on('end', () => {
      onSuccess(JSON.parse(rawData));
    });
  });
}

function downloadZip(url: string, onSuccess: (data: Buffer) => void) {
  https.get(url, (res) => {
    const { statusCode } = res;
    const contentType = res.headers['content-type'];

    if (statusCode !== 200) {
      throw new Error(`Failed to download build list. HTTP status code = ${statusCode}`);
    }
    if (!contentType || !/^application\/zip/.test(contentType)) {
      throw new Error(`unexpected content type: ${contentType}`);
    }

    const chunks: Buffer[] = [];
    res.on('data', (chunk) => {
      chunks.push(chunk);
    });
    res.on('end', () => {
      onSuccess(Buffer.concat(chunks));
    });
  });
}

function extractFile(zip: jszip, folder: string, file: string, artifactName: string) {
  zip
    .file(`${artifactName}/${file}`)!
    .nodeStream()
    .pipe(fs.createWriteStream(path.join(folder, file)))
    .on('finish', () => {
      console.log('# file downloaded and extracted: ' + file);
    });
}

console.log(
  `=== Start to pull ${config} WebAssembly artifacts from CI for ${
    buildId ? `build "${buildId}"` : 'latest "main" branch'
  } ===`,
);

// Bootstrap global-agent to honor the proxy settings in
// environment variables, e.g. GLOBAL_AGENT_HTTPS_PROXY.
// See https://github.com/gajus/global-agent/blob/v3.0.0/README.md#environment-variables for details.
globalAgentBootstrap();

const filter = buildId
  ? `&buildIds=${buildId}`
  : '&definitions=161' +
    '&resultFilter=succeeded%2CpartiallySucceeded' +
    '&$top=1' +
    '&repositoryId=Microsoft/onnxruntime' +
    '&repositoryType=GitHub' +
    '&branchName=refs/heads/main';

// API reference: https://docs.microsoft.com/en-us/rest/api/azure/devops/build/builds/list
downloadJson(
  `https://dev.azure.com/onnxruntime/onnxruntime/_apis/build/builds?api-version=6.1-preview.6${filter}`,
  (data) => {
    const buildId = data.value[0].id;

    console.log(`=== Found latest build on main branch: ${buildId} ===`);

    // API reference: https://docs.microsoft.com/en-us/rest/api/azure/devops/build/artifacts/get%20artifact
    downloadJson(
      `https://dev.azure.com/onnxruntime/onnxruntime/_apis/build/builds/${buildId}/artifacts?api-version=6.1-preview.5`,
      (data) => {
        let zipLink;
        for (const v of data.value) {
          if (v.name === folderName) {
            zipLink = v.resource.downloadUrl;
          }
        }

        console.log('=== Ready to download zip files ===');

        const WASM_FOLDER = path.join(__dirname, '../dist');
        if (!fs.existsSync(WASM_FOLDER)) {
          fs.mkdirSync(WASM_FOLDER);
        }
        downloadZip(zipLink, (buffer) => {
          void jszip.loadAsync(buffer).then((zip) => {
            extractFile(zip, WASM_FOLDER, 'ort-wasm-simd-threaded.wasm', folderName);
            extractFile(zip, WASM_FOLDER, 'ort-wasm-simd-threaded.jsep.wasm', folderName);

            extractFile(zip, WASM_FOLDER, 'ort-wasm-simd-threaded.mjs', folderName);
            extractFile(zip, WASM_FOLDER, 'ort-wasm-simd-threaded.jsep.mjs', folderName);
          });
        });
      },
    );
  },
);
