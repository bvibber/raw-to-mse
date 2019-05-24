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
        this.width = format.width;
        this.height = format.height;
        this.widthMB = Math.ceil(this.width / 16);
        this.heightMB = Math.ceil(this.height / 16);

        this.spsHeader = generateSPS(format);
        this.ppsHeader = generatePPS(format);
        this.sliceHeader = generateSliceHeader(format);
    }

    sps() {
        return this.spsHeader;
    }

    pps() {
        return this.ppsHeader;
    }

    streamHeader() {
        let sps = this.sps();
        let pps = this.pps();
        let buffer = new ArrayBuffer(sps.length + pps.length);
        let dest = new Uint8Array(buffer);
        dest.set(sps, 0);
        dest.set(pps, sps.length);
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
        let macroblock = (i, j) => {
            if (! ((i == 0) && (j == 0))) {
                dest[pos] = macroblockHeader[0];
                dest[pos + 1] = macroblockHeader[1];
                pos += 2;
            }

            let y_start = i * 16;
            let y_end = (i + 1) * 16;
            let x_start = j * 16;
            let x_end = (j + 1) * 16;
            let height = this.height;
            for (let y = y_start; y < y_end; y++) {
                if (y > height) {
                    // Fill in a fake empty row if beyond end of input.
                    for (let x = x_start; x < x_end; x++) {
                        dest[pos++] = 16;
                    }
                    continue;
                }
                let start = y * strideY + x_start;
                // Note if we see 0 in the data, it may be
                // unsafe as it could combine with other bytes
                // to be a start code emulation which breaks
                // parsing. Since these don't happen in real
                // data anyway, and will mostly occur as
                // 'undefined' when reading past the end of
                // a non-16-byte-aligned buffer....
                dest[pos + 0] = bytesY[start + 0];
                dest[pos + 1] = bytesY[start + 1];
                dest[pos + 2] = bytesY[start + 2];
                dest[pos + 3] = bytesY[start + 3];
                dest[pos + 4] = bytesY[start + 4];
                dest[pos + 5] = bytesY[start + 5];
                dest[pos + 6] = bytesY[start + 6];
                dest[pos + 7] = bytesY[start + 7];
                dest[pos + 8] = bytesY[start + 8];
                dest[pos + 9] = bytesY[start + 9];
                dest[pos + 10] = bytesY[start + 10];
                dest[pos + 11] = bytesY[start + 11];
                dest[pos + 12] = bytesY[start + 12];
                dest[pos + 13] = bytesY[start + 13];
                dest[pos + 14] = bytesY[start + 14];
                dest[pos + 15] = bytesY[start + 15];
                pos += 16;
            }

            // @todo what about 4:2:2 or 4:4:4?
            // is that possible in h264?
            // can easily decimate to hack a downsample.

            y_start >>= 1;
            y_end >>= 1;
            x_start >>= 1;
            x_end >>= 1;

            for (let y = y_start; y < y_end; y++) {
                if (y > height) {
                    // Fill in a fake empty row if beyond end of input.
                    for (let x = x_start; x < x_end; x++) {
                        dest[pos++] = 128;
                    }
                    continue;
                }
                let start = y * strideU + x_start;
                dest[pos + 0] = bytesU[start + 0];
                dest[pos + 1] = bytesU[start + 1];
                dest[pos + 2] = bytesU[start + 2];
                dest[pos + 3] = bytesU[start + 3];
                dest[pos + 4] = bytesU[start + 4];
                dest[pos + 5] = bytesU[start + 5];
                dest[pos + 6] = bytesU[start + 6];
                dest[pos + 7] = bytesU[start + 7];
                pos += 8;
            }

            for (let y = y_start; y < y_end; y++) {
                if (y > height) {
                    // Fill in a fake empty row if beyond end of input.
                    for (let x = x_start; x < x_end; x++) {
                        dest[pos++] = 128;
                    }
                    continue;
                }
                let start = y * strideV + x_start;
                dest[pos + 0] = bytesV[start + 0];
                dest[pos + 1] = bytesV[start + 1];
                dest[pos + 2] = bytesV[start + 2];
                dest[pos + 3] = bytesV[start + 3];
                dest[pos + 4] = bytesV[start + 4];
                dest[pos + 5] = bytesV[start + 5];
                dest[pos + 6] = bytesV[start + 6];
                dest[pos + 7] = bytesV[start + 7];
                pos += 8;
            }
        };

        for (let i of this.sliceHeader) {
            dest[pos++] = i;
        }

        for (let i = 0; i < this.heightMB; i++) {
            for (let j = 0; j < this.widthMB; j++) {
                macroblock(i, j);
            }
        }

        dest[pos++] = 0x80; // slice stop bit

        return buffer;
    }
}

class BitWriter {
    constructor() {
        this.bytes = [];
        this.cursor = 0;
        this.currentByte = 0;
    }

    writeBit(val) {
        this.currentByte |= (((val & 1) << 7) >> (this.cursor++));
        if (this.cursor == 8) {
            this.bytes.push(this.currentByte);
            this.currentByte = 0;
            this.cursor = 0;
        }
    }

    writeBits(num, val) {
        for (let i = 0; i < num; i++) {
            let bit = (val >> (num - i - 1)) & 1;
            this.writeBit(bit);
        }
    }

    writeExp(val) {
        // https://en.wikipedia.org/wiki/Exponential-Golomb_coding
        let x = val + 1;
        let c = (32 - Math.clz32(x));
        this.writeBits(c - 1, 0);
        this.writeBits(c, x);
    }

    collect() {
        let bytes = this.bytes;
        if (this.cursor > 0) {
            bytes = bytes.concat([this.currentByte]);
        }
        return new Uint8Array(bytes);
    }
}

function generateSPS(format) {
    let widthMB = Math.ceil(format.width / 16);
    let heightMB = Math.ceil(format.height / 16);
    let width = widthMB * 16;
    let height = heightMB * 16;
    let cropLeft = format.cropLeft;
    let cropTop = format.cropTop;
    let cropRight = width - cropLeft - format.cropWidth;
    let cropBottom = height - cropTop - format.cropHeight;

    let bits = new BitWriter();

    bits.writeBits(8, 0);
    bits.writeBits(8, 0);
    bits.writeBits(8, 0);
    bits.writeBits(8, 1);

    // cf https://cardinalpeak.com/blog/the-h-264-sequence-parameter-set/
    bits.writeBit(0); // forbidden_zero_bit
    bits.writeBits(2, 3); // nal_ref_idc - "important" NAL marker
    bits.writeBits(5, 7); // nal_unit_type - 7 = SPS NAL type

    bits.writeBits(8, 66); // profile_idc - baseline profile
    bits.writeBit(0); // constraint_set0_flag
    bits.writeBit(1); // constraint_set1_flag
    bits.writeBit(0); // constraint_set2_flag
    bits.writeBit(0); // constraint_set3_flag
    bits.writeBits(4, 0); // reserved_zero_4bits
    bits.writeBits(8, 51); // level_idc - level 5.1
    bits.writeExp(0); // seq_parameter_set_id
    bits.writeExp(0); // log2_max_frame_num_minus4
    bits.writeExp(0); // pic_order_cnt_type
    bits.writeExp(0); // log2_max_pic_order_cnt_lsb_minus4
    bits.writeExp(0); // num_ref_frames
    bits.writeBit(0); // gaps_in_frame_num_value_allowed_flag
    bits.writeExp(widthMB - 1); // pic_width_in_mbs_minus_1
    bits.writeExp(heightMB - 1); // pic_height_in_map_units_minus_1
    bits.writeBit(1); // frame_mbs_only_flag -- no fields
    bits.writeBit(0); // direct_8x8_inference_flag -- no B frames
    if (cropLeft || cropRight || cropTop || cropBottom) {
        bits.writeBit(1); // frame_cropping_flag
        bits.writeExp(cropLeft >> 1); // frame_crop_left_offset
        bits.writeExp(cropRight >> 1); // frame_crop_right_offset
        bits.writeExp(cropTop >> 1); // frame_crop_top_offset
        bits.writeExp(cropBottom >> 1); // frame_crop_bottom_offset
    } else {
        bits.writeBit(0); // frame_cropping_flag
    }
    bits.writeBit(0); // vui_prameters_present_flag -- not present
    bits.writeBit(1); // rbsp_stop_one_bit

    return bits.collect();
}

function generatePPS(format) {
    let bits = new BitWriter();

    bits.writeBits(8, 0);
    bits.writeBits(8, 0);
    bits.writeBits(8, 0);
    bits.writeBits(8, 1);

    bits.writeBit(0); // forbidden_zero_bit
    bits.writeBits(2, 3); // nal_ref_idc - "important" NAL marker
    bits.writeBits(5, 8); // nal_unit_type - 8 = PPS NAL type

    bits.writeExp(0); // pic_parameter_set_id
    bits.writeExp(0); // seq_parameter_set_id
    bits.writeBit(0); // entropy_coding_mode_flag ??
    bits.writeBit(0); // bottom_field_pic_order_in_frame_present_flag
    bits.writeExp(0); // num_slice_groups_minus1 ??
    bits.writeExp(0); // num_ref_idx_l0_default_active_minus1 ?
    bits.writeExp(0); // num_ref_idx_l1_default_active_minus1 ?
    bits.writeBit(0); // weighted_pred_flag
    bits.writeBits(2, 0); // weighted_bipred_idc
    bits.writeExp(0); // pic_init_qp_minus26 (SIGNED)
    bits.writeExp(0); // pic_init_qs_minus26 (SIGNED)
    bits.writeExp(0); // chroma_qp_index_offset (SIGNED)
    bits.writeBit(0); // deblocking_filter_control_present_flag
    bits.writeBit(0); // constrained_intra_pred_flag
    bits.writeBit(0); // redundant_pic_cnt_present_flag

    bits.writeBit(1); // transform_8x8_mode_flag
    bits.writeBit(0); // pic_scaling_matrix_present_flag

    return bits.collect();
}

function generateSliceHeader(format) {
    let bits = new BitWriter();

    bits.writeBits(8, 0);
    bits.writeBits(8, 0);
    bits.writeBits(8, 0);
    bits.writeBits(8, 1);

    bits.writeBit(0); // forbidden_zero_bit
    bits.writeBits(2, 0); // nal_ref_idc
    bits.writeBits(5, 5); // nal_unit_type - 5 = slice with no partitioning IDR NAL type

    bits.writeExp(0); // first_mb_in_slice
    bits.writeExp(7); // slice_type -- I_PCM (7)
    bits.writeExp(0); // pic_parameter_set_id
    bits.writeBits(4, 0); // ?? frame_num ??? u(v)

    bits.writeExp(0); // idr_pic_id ???
    bits.writeBits(4, 0); // pic_order_cnt_lsb ??????

    bits.writeExp(0); // slice_qp_delta (SIGNED)

    // not quite sure what these are yet
    bits.writeBit(0);
    bits.writeBit(0);
    bits.writeBit(0);
    bits.writeBit(0);
    bits.writeBit(1);

    bits.writeBit(1);
    bits.writeBit(0);
    bits.writeBit(1);

    return bits.collect();
}


module.exports = YUVToH264;
