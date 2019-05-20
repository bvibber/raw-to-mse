# raw-to-mse

Experimental tool to build uncompressed audio/video buffers that can be pushed into an HTML `<video>` element through Media Source Extensions.

# Background

Currently, MSE provides no interface for playing raw video frames or audio buffers, but requires that data be provided in compressed form. This is great for standard formats that are implemented in hardware or optimized native code, but makes extra work for data in older (or newer) data formats with custom codecs, or dynamically-generated data such as real-time mixing and filtering.

I'm investigating a hackaround to feed uncompressed data by repacking it into formats that the browser can decode cheaply. There is some cost to reshuffling buffers, but if it works there are advantages in using a real native `<video>` element over `<canvas>` and Web Audio.

# Submodules

* yuv-to-h264
* pcm-to-flac
* pcm-to-alac

# Fomat details

## Muxing: fragmanted MP4

For now I plan to outsource muxing to [mux.js](https://github.com/videojs/mux.js).

## Video: h.264

Based on a conference talk questioner's suggestion to look into Ben Mesander's "[The World's Smallest h.264 Encoder](https://cardinalpeak.com/blog/worlds-smallest-h-264-encoder/)", I've ported Ben's example code to JavaScript and will experiment with adding full support for various resolutions.

This uses h.264's I_PCM mode to encode macroblocks full of raw YUV data, without even doing a DCT transform. This is essentially a shuffled buffer copy, as the rectangular input data is cut into 16x16 pixel macroblocks and copied over a bit at a time with some header/footer bytes.

There is no compression going on, just some headers in a fairly normal kind of bitstream and the raw YUV data, so in theory no one runs afoul of anything patented.

## Audio: FLAC

Most browsers now support the lossless FLAC audio encoding in MP4 container, including in MSE. I'm having trouble with it in Safari, which advertises support but does not play any audio in my tests, however.

It should also possible to optimize the encoding for speed by encoding raw PCM blocks without compression, since it's meant to be consumed and thrown away within seconds of encoding.

## Audio: ALAC

For Safari, it may be necessary to use "Apple Lossless" or ALAC encoding. Like FLAC it can encode packets of raw PCM data with no compression.

ALAC was open-sourced by Apple in 2011, and [source code is available for reference](https://github.com/macosforge/alac/tree/master/codec).

