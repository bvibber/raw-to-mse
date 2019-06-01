//
// Utility class for bitstream writing
//
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

    writeUTF8(val) {
        val = val | 0;
        if (val < 0x80) {
            this.writeBit(0);
            this.writeBits(7, val & 0x7f);
        } else if (val < 0x800) {
            this.writeBits(3, 6); // 110
            this.writeBits(5, val >> 6);
            this.writeBits(2, 2); // 10
            this.writeBits(6, val & 0x3f);
        } else if (val < 0x10000) {
            this.writeBits(4, 0xe); // 1110
            this.writeBits(4, val >> 12);
            this.writeBits(2, 2); // 10
            this.writeBits(6, (val >> 6) & 0x3f);
            this.writeBits(2, 2); // 10
            this.writeBits(6, val & 0x3f);
        } else {
            this.writeBits(5, 0x1e); // 11110
            this.writeBits(3, val >> 18);
            this.writeBits(2, 2); // 10
            this.writeBits(6, (val >> 12) & 0x3f);
            this.writeBits(2, 2); // 10
            this.writeBits(6, (val >> 6) & 0x3f);
            this.writeBits(2, 2); // 10
            this.writeBits(6, val & 0x3f);
        }
    }

    collect() {
        let bytes = this.bytes;
        if (this.cursor > 0) {
            bytes = bytes.concat([this.currentByte]);
        }
        return new Uint8Array(bytes);
    }
}

module.exports = BitWriter;
