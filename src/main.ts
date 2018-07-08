
export const VERSION = '0.3';

import * as nconf from 'nconf';
import * as fs from 'fs';
import * as path from 'path';

import * as git from './utils/git';

process.on('unhandledRejection', (reason, p) => {
    const now = new Date();
    console.log(now.toLocaleDateString() + '/' + now.toLocaleTimeString() + ': unhandled rejection at: Promise', p, 'reason:', reason);
});


// ***********************************************************
// configuration, logging
// ***********************************************************

nconf.argv().env();
const configFilename = path.join(__dirname, '../config.json');
try {
    fs.accessSync(configFilename, fs.constants.R_OK);
    nconf.file(configFilename);
} catch (err) {
    console.log('Error on config file ' + configFilename + '\n' + err);
    process.exit(1);
}

let debugConfig: any = nconf.get('debug');
if (!debugConfig) {
    debugConfig = { debug: '*::*' };
}
for (const a in debugConfig) {
    if (debugConfig.hasOwnProperty(a)) {
        const name: string = (a === 'enabled') ? 'DEBUG' : 'DEBUG_' + a.toUpperCase();
        if (!process.env[name] && (debugConfig[a] !== undefined || debugConfig[a] !== undefined)) {
            process.env[name] = debugConfig[a] ? debugConfig[a] : debugConfig[a];
        }
    }
}

// logging with debug-sx/debug
import * as debugsx from 'debug-sx';
const debug: debugsx.ISimpleLogger = debugsx.createSimpleLogger('main');

debugsx.addHandler(debugsx.createConsoleHandler('stdout'));
const logfileConfig = nconf.get('logfile');
if (logfileConfig) {
    for (const att in logfileConfig) {
        if (!logfileConfig.hasOwnProperty(att)) { continue; }
        const logHandlerConfig = logfileConfig[att];
        if (logHandlerConfig.disabled) { continue; }
        const h = debugsx.createFileHandler( logHandlerConfig);
        console.log('Logging ' + att + ' to ' + logHandlerConfig.filename);
        debugsx.addHandler(h);
    }
}


// ***********************************************************
// startup of application
//   ... things to do before server can be started
// ***********************************************************

import * as SerialPort from 'serialport';
import { sprintf } from 'sprintf-js';
// import { ModbusCrc } from './modbus/modbus-crc';
import { ModbusFrame } from './modbus/modbus-frame';

doStartup();

async function doStartup () {
    try {
        const gitInfo = await git.getGitInfo();
        startupPrintVersion(gitInfo);
        await startupParallel();
        await startupShutdown();
        doSomeTests();

    } catch (err) {
        console.log(err);
        console.log('-----------------------------------------');
        console.log('Error: exit program');
        process.exit(1);
    }
}



// ***********************************************************
// startup and shutdown functions
// ***********************************************************

async function shutdown (src: string): Promise<void> {
    debug.info('starting shutdown ... (caused by %s)', src || '?');
}

function startupPrintVersion (info?: git.GitInfo) {
    console.log('main.ts Version ' + VERSION);
    if (info) {
        console.log('GIT: ' + info.branch + ' (' + info.hash + ')');
        const cnt = info.modified.length;
        console.log('     ' + (cnt === 0 ? 'No files modified' : cnt + ' files modified'));
    }
}

async function startupParallel (): Promise<any []> {
    debug.info('startupParallel finished');
    return [];
}

async function startupShutdown (): Promise<void> {
    const shutdownMillis = +nconf.get('shutdownMillis');
    if (shutdownMillis > 0) {
        setTimeout( () => {
            shutdown('startupShutdown').then( () => {
                console.log('shutdown successful');
                process.exit(0);
            }).catch( err => {
                console.log(err);
                console.log('shutdown fails');
                process.exit(1);
            });
        }, shutdownMillis);
        debug.info('startupShutdown finished, shutdown in ' + (shutdownMillis / 1000) + ' seconds.');
    }
}

async function doSomeTests () {
    debug.info('.... running');
    return;
}

// ***********************************************************
// other stuff...
// ***********************************************************

const message = 'Start of program V' + VERSION;
console.log(message);

let frame = '';
let startAddress = -1, quantity = -1;
// let r43Old = -1;

const serial: { device: string, baudrate: number } = nconf.get('serial');
if (!serial || !serial.device || !serial.baudrate) {
    process.exit(1);
}
const port = new SerialPort(serial.device, {
    baudRate: serial.baudrate
});

port.open();

port.on('open', () => {
    console.log('----------------------------------------------------');
    console.log('serial port ' + serial.device + ' opened');
});

port.on('error', (err) => {
    console.log('serial port error');
    if (err instanceof Error) {
        console.log(err);
    }
});

function signed16BitValue (reg: number): number {
    return reg > 0x7fff ? reg - 0x10000 : reg;
}

function signed32BitValue (regH: number, regL: number): number {
    const rv = regH * 65536 + regL;
    return rv > 0x7fffffff ? rv - 0x100000000 : rv;
}

function unsigned32BitValue (regH: number, regL: number): number {
    return regH * 65536 + regL;
}



function handleModbusData (f: string) {
    const modbusFrame = new ModbusFrame(f);
}



port.on('data', (data: Buffer) => {
    if (data instanceof Buffer) {
        // console.log('Buffer with ' + data.length + ' Bytes received');
        for (const b of data.values()) {
            if (b === 10) {
                // console.log(frame);
                handleModbusData(frame);
                if (frame.startsWith('0103')) {
                    if (frame.length === 16 || frame.length === 18) {
                        // modbus request
                        const startTxt = frame.substr(6, 4);
                        const quantityTxt = frame.substr(10, 4);
                        startAddress = parseInt(startTxt, 16);
                        quantity = parseInt(quantityTxt, 16);
                    } else if (startAddress < 0 || frame.length < 246 || !frame.startsWith('010376')) {
                        console.log(frame.length + ' ?-> ' + frame);
                    } else {
                        // modbus froniusmeter response

                        let s = '';
                        const regs: number [] = [];
                        for (let i = 0; i < quantity; i++) {
                            const regTxt = frame.substr(6 + i * 4, 4);
                            regs.push(parseInt(regTxt, 16));
                        }

                        const now = new Date();
                        const filename = sprintf('/var/log/fronius/%04d-%02d-%02d_fronius.csv',
                                         now.getFullYear(), now.getMonth() + 1, now.getDate());
                        let t = '"Time"';      s = '"' + now.toLocaleTimeString() + '"';
                        t += ',"E-in/kWh"';    s += sprintf(',"%8.03f"', unsigned32BitValue(regs[28], regs[29]) / 1000);
                        t += ',"E-out/kWh"';   s += sprintf(',"%8.03f"', unsigned32BitValue(regs[32], regs[33]) / 1000);
                        t += ',"f/Hz"';        s += sprintf(',"%4.01f"', regs[38] / 10);
                        t += ',"P/W"';         s += sprintf(',"%7.02f"', signed32BitValue(regs[20], regs[21]) / 100);
                        t += ',"Q/var"';       s += sprintf(',"%6.02f"', signed32BitValue(regs[22], regs[23]) / 100);
                        t += ',"S/VA"';        s += sprintf(',"%7.02f"', signed32BitValue(regs[24], regs[25]) / 100);
                        t += ',"Q-in/kvarh"';  s += sprintf(',"%8.03f"', unsigned32BitValue(regs[30], regs[31]) / 1000);
                        t += ',"Q-out/kvarh"'; s += sprintf(',"%8.03f"', unsigned32BitValue(regs[34], regs[35]) / 1000);
                        t += ',"P1/W"';        s += sprintf(',"%8.02f"', signed32BitValue(regs[44], regs[45]) / 100);
                        t += ',"P2/W"';        s += sprintf(',"%8.02f"', signed32BitValue(regs[46], regs[47]) / 100);
                        t += ',"P3/W"';        s += sprintf(',"%8.02f"', signed32BitValue(regs[48], regs[49]) / 100);

                        if (!fs.existsSync(filename)) {
                            fs.writeFileSync(filename, t + '\n');
                        }

                        s = s.replace(/\./g, ',');
                        fs.appendFileSync(filename, s + '\n');

                        // s = new Date().toLocaleTimeString();
                        // s = s + sprintf(' U1=%5.01fV', (regs[0] * 65536 +  regs[1]) / 1000);
                        // s = s + sprintf(' U2=%5.01fV', (regs[2] * 65536 +  regs[3]) / 1000);
                        // s = s + sprintf(' U3=%5.01fV', (regs[4] * 65536 +  regs[5]) / 1000);
                        // s = s + '  ';
                        // s = s + sprintf(' I1=%6.03fA', (regs[6] * 65536 +  regs[7]) / 1000);
                        // s = s + sprintf(' I2=%6.03fA', (regs[8] * 65536 +  regs[9]) / 1000);
                        // s = s + sprintf(' I3=%6.03fA', (regs[10] * 65536 +  regs[11]) / 1000);


                        // s = s + sprintf(' U1=%5.01fV', (regs[0] * 65536 +  regs[1]) / 1000);
                        // s = s + sprintf(' U2=%5.01fV', (regs[2] * 65536 +  regs[3]) / 1000);
                        // s = s + sprintf(' U3=%5.01fV', (regs[4] * 65536 +  regs[5]) / 1000);
                        // s = s + '  ';
                        // s = s + sprintf(' I1=%6.03fA', (regs[6] * 65536 +  regs[7]) / 1000);
                        // s = s + sprintf(' I2=%6.03fA', (regs[8] * 65536 +  regs[9]) / 1000);
                        // s = s + sprintf(' I3=%6.03fA', (regs[10] * 65536 +  regs[11]) / 1000);
                        // s = s + '  ';
                        // s = s + sprintf(' r12=%d', regs[12]); // = 0
                        // s = s + sprintf(' r13=%d', regs[13]); // = 0
                        // s = s + '  ';
                        // s = s + sprintf(' U12=%5.01fV', unsigned32BitValue(regs[14], regs[15]) / 1000);
                        // s = s + sprintf(' U23=%5.01fV', unsigned32BitValue(regs[16], regs[17]) / 1000);
                        // s = s + sprintf(' U31=%5.01fV', unsigned32BitValue(regs[18], regs[19]) / 1000);
                        // s = s + '  ';
                        // s = s + sprintf(' P=%7.01fW', signed32BitValue(regs[20], regs[21]) / 100);
                        // s = s + sprintf(' Q=%6.01fvar', signed32BitValue(regs[22], regs[23]) / 100);
                        // s = s + sprintf(' S=%7.01fVA', signed32BitValue(regs[24], regs[25]) / 100);
                        // s = s + '  ';
                        // s = s + sprintf(' ?=%2f', signed32BitValue(regs[26], regs[27]));
                        // s = s + sprintf(' r26=%d', regs[26]); // = 0
                        // s = s + sprintf(' r27=%d', regs[27]); // = 0
                        // s = s + '  ';
                        // s = s + sprintf(' E-in=%8.03fkWh', unsigned32BitValue(regs[28], regs[29]) / 1000);
                        // s = s + sprintf(' Q-in=%8.03fkvarh', unsigned32BitValue(regs[30], regs[31]) / 1000);
                        // s = s + '  ';
                        // s = s + sprintf(' Eout=%8.03fkWh', unsigned32BitValue(regs[32], regs[33]) / 1000);
                        // s = s + sprintf(' Qout=%8.03fkvarh', unsigned32BitValue(regs[34], regs[35]) / 1000);
                        // s = s + '  ';
                        // s = s + sprintf('  r36=%6d', signed16BitValue(regs[36]));
                        // s = s + sprintf(' Lmb=%5.02f', signed16BitValue(regs[36]) / 100);
                        // switch (regs[37]) {
                        //     case 0:  s = s + ' NoP'; break;
                        //     case 1:  s = s + ' IND'; break;
                        //     case 2:  s = s + ' CAP'; break;
                        //     default: s = s + ' ???'; break;
                        // }
                        // s = s + sprintf(' f=%04.01fHz', regs[38] / 10);
                        // s = s + sprintf(' Pavg=%8.03fW', unsigned32BitValue(regs[39], regs[40]) / 100);
                        // s = s + sprintf(' Pavgmax=%8.03fW', unsigned32BitValue(regs[41], regs[42]) / 100);
                        // if (r43Old === 4 && regs[43] === 0) {
                        //     s = s + '   UPD';
                        // } else {
                        //     switch (regs[43]) {
                        //         case 0:  s = s + ' AVG-0'; break;
                        //         case 1:  s = s + ' AVG-1'; break;
                        //         case 2:  s = s + ' AVG-2'; break;
                        //         case 3:  s = s + ' AVG-3'; break;
                        //         case 4:  s = s + ' AVG-4'; break;
                        //         deif (b === 10) {fault: s = s + ' ?????'; break;
                        //     }
                        // }
                        // r43Old = regs[43];
                        // s = s + sprintf('  r43=%d', regs[43]);
                        // s = s + '  ';
                        // s = s + sprintf(' P1=%8.02fW', signed32BitValue(regs[44], regs[45]) / 100);
                        // s = s + sprintf(' P2=%8.02fW', signed32BitValue(regs[46], regs[47]) / 100);
                        // s = s + sprintf(' P3=%8.02fW', signed32BitValue(regs[48], regs[49]) / 100);
                        // s = s + '  ';
                        // s = s + sprintf(' Q1=%6.02f', signed32BitValue(regs[50], regs[51]) / 100);
                        // s = s + sprintf(' Q2=%6.02f', signed32BitValue(regs[52], regs[53]) / 100);
                        // s = s + sprintf(' Q3=%6.02f', signed32BitValue(regs[54], regs[55]) / 100);
                        // s = s + '  ';
                        // s = s + sprintf('  r56=%6d', signed16BitValue(regs[56]));
                        // s = s + sprintf('  r57=%6d', signed16BitValue(regs[57]));
                        // s = s + sprintf('  r58=%6d', signed16BitValue(regs[58]));
                        // s = s + sprintf(' Lmb1=%5.02f', signed16BitValue(regs[56]) / 100);
                        // s = s + sprintf(' Lmb2=%5.02f', signed16BitValue(regs[57]) / 100);
                        // s = s + sprintf(' Lmb3=%5.02f', signed16BitValue(regs[58]) / 100);
                        // s = s + sprintf('  r59=%6d', signed16BitValue(regs[59])); // CRC

                        // console.log(s);
                    }
                }
                frame = '';

            } else if (b !== 13) {
                frame = frame + String.fromCharCode(b);
            }
        }
    } else {
        console.log('Warning: receiving .... but not a Buffer ...');
        console.log(data);
    }
});










// port.on('readable', () => {
//     const data =  port.read(1);
// });

