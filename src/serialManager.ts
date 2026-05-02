import { EventEmitter } from 'events';

// SerialPort is optional — if the package isn't installed or the port doesn't
// exist, the server still starts and all non-hardware features work fine.
let SerialPortClass: any;
let ReadlineParserClass: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SerialPortClass = require('serialport').SerialPort;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ReadlineParserClass = require('@serialport/parser-readline').ReadlineParser;
} catch {
  console.warn('serialport package not found — running without Arduino hardware.');
}

export class SerialManager extends EventEmitter {
  private port: any = null;

  connect(portPath: string, baudRate = 115200): void {
    if (!SerialPortClass) return;

    try {
      this.port = new SerialPortClass({ path: portPath, baudRate });
      const parser = this.port.pipe(new ReadlineParserClass({ delimiter: '\n' }));

      this.port.on('open', () => console.log(`Serial: ${portPath} open`));
      this.port.on('close', () => { console.log('Serial: closed'); this.port = null; });
      this.port.on('error', (err: Error) => console.error('Serial error:', err.message));

      parser.on('data', (line: string) => {
        const msg = line.trim();
        if (!msg) return;
        console.log(`Arduino → Pi: ${msg}`);

        if (msg === 'READY') {
          this.emit('ready');
        } else if (msg === 'RINGER:1') {
          this.emit('ringer', 1);
        } else if (msg === 'RINGER:2') {
          this.emit('ringer', 2);
        }
      });
    } catch (err) {
      console.error('Failed to open serial port:', (err as Error).message);
    }
  }

  send(command: string): void {
    if (!this.port?.isOpen) {
      console.log(`[no-hw] → ${command}`);
      return;
    }
    const msg = command.endsWith('\n') ? command : command + '\n';
    console.log(`Pi → Arduino: ${msg.trim()}`);
    this.port.write(msg);
  }

  isConnected(): boolean {
    return this.port?.isOpen === true;
  }
}
