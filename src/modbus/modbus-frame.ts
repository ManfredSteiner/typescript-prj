
import { sprintf } from 'sprintf-js';
import { ModbusCrc } from './modbus-crc';

import * as debugsx from 'debug-sx';
const debug: debugsx.ISimpleLogger = debugsx.createSimpleLogger('modbus:ModbusFrame');


export class ModbusFrame {

    private _at: Date;
    private _frame?: string;
    private _buffer: Buffer;
    private _frameErrorCount: number;

    public constructor (frame?: string) {
        this._at = new Date();
        this._frameErrorCount = 0;
        if (typeof(frame) === 'string') {
            this._frame = frame;
            this.initFromHexString(frame, frame.length);
            const crc = new ModbusCrc();
            crc.update(this._buffer, 0, this._buffer.length - 2);
            console.log(sprintf('CRC: %04x', crc.crc));
        }

    }

    private hexToByte (s: string, offset: number): number {
        const x = s.substr(offset, 2);
        return parseInt(x, 16);
    }

    private initFromHexString (frame: string, length?: number) {
        const b = Buffer.alloc(256);
        length = length >= 0 ? length : frame.length;
        let offset = 0;
        for (let i = 0; i <= length; i += 2) {
            try {
                b[offset++] = this.hexToByte(frame, i);
            } catch (err) {
                this._frameErrorCount++;
            }
        }
        this._buffer = Buffer.alloc(offset - 1, b);
        debug.info(this._frame);
        console.log('Errors: ' + this._frameErrorCount);
        console.log('Frame: ' + this._frame);
        console.log(this._buffer);

    }

}