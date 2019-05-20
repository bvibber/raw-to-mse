/*
 * Converts raw YUV frame buffer into an uncompressed H.264 packet.
 * This mostly consists of shuffling the buffers into macroblocks
 * and outputting the appropriate headers.
 *
 * This is intended for use feeding custom data into a `<video>`
 * element via Media Source Extensions, such as frames decoded from
 * a video format not supported natively by the browser.
 *
 * Copyright (c) 2019, Brion Vibber <brion@pobox.com>
 *
 * Based on code from "hello264" by Ben Mesander,
 * https://cardinalpeak.com/blog/worlds-smallest-h-264-encoder/
 *
 * Copyright (c) 2010, Cardinal Peak, LLC.  http://cardinalpeak.com
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 
 * 1) Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 
 * 2) Redistributions in binary form must reproduce the above
 *    copyright notice, this list of conditions and the following
 *    disclaimer in the documentation and/or other materials provided
 *    with the distribution.
 * 
 * 3) Neither the name of Cardinal Peak nor the names of its
 *    contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
 * FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
 * CARDINAL PEAK, LLC BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF
 * USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
 * OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

class YUVToH264 {
    /**
     * Set up an "encoder" for raw YUV data in h.264 video packets.
     * 
     * @param {YUVFormat} format metadata on frame size/layout
     */
    constructor(format) {
        this.width = 128; /* format.width; */
        this.height = 96; /* format.height */
        this.widthMB = this.width / 16;
        this.heightMB = this.height / 16;

        // H.264 bitstreams
        // @todo generate sps and pps from proper data
        // see https://cardinalpeak.com/blog/the-h-264-sequence-parameter-set/
        this.sps = [0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0x00, 0x0a, 0xf8, 0x41, 0xa2];
        this.pps = [0x00, 0x00, 0x00, 0x01, 0x68, 0xce, 0x38, 0x80];
        this.sliceHeader = [0x00, 0x00, 0x00, 0x01, 0x05, 0x88, 0x84, 0x21, 0xa0];
    }

    streamHeader() {
        let buffer = new ArrayBuffer(this.sps.length + this.pps.length);
        let dest = new Uint8Array(buffer);
        dest.set(this.sps, 0);
        dest.set(this.pps, this.sps.length);
        return buffer;
    }

    /**
     * Encode a raw YUV frame as an uncompressed H.264 packet.
     *
     * An MP4 muxing step will be required on top of this,
     * which will also require the stream and picture setup
     * elements.
     * 
     * @param {YUVFrame} frame 
     * @returns ArrayBuffer
     */
    encodeFrame(frame) {
        // First we must predict the size of the whole frame to allocate a buffer
        let countMB = this.widthMB * this.heightMB;
        let macroblockHeader = [0x0d, 0x00];
        let lenPerMB = 16 * 16 + 8 * 8 + 8 * 8;
        let lenStopBit = 1;
        let len = this.sliceHeader.length
            + (countMB - 1) * macroblockHeader.length
            + (countMB * lenPerMB)
            + lenStopBit;
        let buffer = new ArrayBuffer(len);
        let dest = new Uint8Array(buffer);
        let pos = 0;

        let bytesY = frame.y.bytes;
        let bytesU = frame.u.bytes;
        let bytesV = frame.v.bytes;
        let strideY = frame.y.stride;
        let strideU = frame.u.stride;
        let strideV = frame.v.stride;

        // Write a macroblock's worth of YUV data in I_PCM mode
        function macroblock(i, j) {
            if (! ((i == 0) && (j == 0))) {
                dest[pos] = macroblockHeader[0];
                dest[pos + 1] = macroblockHeader[1];
                pos += 2;
            }

            for (let y = i*16; y < (i+1)*16; y++) {
                let start = y * strideY;
                for (let x = j*16; x < (j+1)*16; x++) {
                    dest[pos++] = bytesY[start + x]
                }
            }

            // @todo what about 4:2:2 or 4:4:4?
            // is that possible in h264?
            // can easily decimate to hack a downsample.

            for (let y = i*8; y < (i+1)*8; y++) {
                let start = y * strideU;
                for (let x = j*8; x < (j+1)*8; x++) {
                    dest[pos++] = bytesU[start + x];
                }
            }

            for (let y = i*8; y < (i+1)*8; y++) {
                let start = y * strideV;
                for (let x = j*8; x < (j+1)*8; x++) {
                    dest[pos++] = bytesV[start + x];
                }
            }
        }

        for (let i of this.sliceHeader) {
            dest[pos++] = i;
        }

        // @todo may have to force new dimensions depending on input
        for (let i = 0; i < this.heightMB; i++) {
            for (let j = 0; j < this.widthMB; j++) {
                macroblock(i, j);
            }
        }

        dest[pos++] = 0x80; // slice stop bit

        return buffer;
    }
}

module.exports = YUVToH264;
