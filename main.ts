// Tiny stack VM, ISA v1.
import * as fs from "node:fs";
import * as path from "node:path";

function runVM(prog: Buffer, input: Buffer): { out: Buffer; code: number } {
  const mem = new Int32Array(256);
  const ds = new Int32Array(257);
  const cs = new Int32Array(64);
  let sp = 0, cp = 0, pc = 0, ip = 0, steps = 0;
  const out: number[] = [];
  let code = 0;
  run: while (true) {
    if (steps >= 1000000) { code = 10; break; }
    if (pc < 0 || pc >= prog.length) { code = 9; break; }
    const op = prog[pc];
    steps++;
    switch (op) {
      case 0x00: code = 0; break run;
      case 0x01:
        if (pc + 1 >= prog.length) { code = 9; break run; }
        if (sp >= 256) { code = 3; break run; }
        ds[sp++] = (prog[pc + 1] << 24) >> 24;
        pc += 2;
        break;
      case 0x02:
        if (pc + 4 >= prog.length) { code = 9; break run; }
        if (sp >= 256) { code = 3; break run; }
        ds[sp++] = prog.readInt32LE(pc + 1);
        pc += 5;
        break;
      case 0x03:
        if (sp < 1) { code = 2; break run; }
        sp--;
        pc++;
        break;
      case 0x04:
        if (sp < 1) { code = 2; break run; }
        if (sp >= 256) { code = 3; break run; }
        ds[sp] = ds[sp - 1];
        sp++;
        pc++;
        break;
      case 0x05:
        if (sp < 2) { code = 2; break run; }
        { const t = ds[sp - 1]; ds[sp - 1] = ds[sp - 2]; ds[sp - 2] = t; }
        pc++;
        break;
      case 0x06:
        if (sp < 2) { code = 2; break run; }
        if (sp >= 256) { code = 3; break run; }
        ds[sp] = ds[sp - 2];
        sp++;
        pc++;
        break;
      case 0x07: {
        if (sp < 3) { code = 2; break run; }
        const a = ds[sp - 3];
        ds[sp - 3] = ds[sp - 2];
        ds[sp - 2] = ds[sp - 1];
        ds[sp - 1] = a;
        pc++;
        break;
      }
      case 0x10: case 0x11: case 0x12: case 0x18: case 0x19: case 0x1a:
      case 0x20: case 0x21: case 0x22: {
        if (sp < 2) { code = 2; break run; }
        const b = ds[--sp], a = ds[sp - 1];
        ds[sp - 1] = op === 0x10 ? (a + b) | 0
          : op === 0x11 ? (a - b) | 0
          : op === 0x12 ? Math.imul(a, b)
          : op === 0x18 ? a & b
          : op === 0x19 ? a | b
          : op === 0x1a ? a ^ b
          : op === 0x20 ? +(a === b)
          : op === 0x21 ? +(a < b)
          : +((a >>> 0) < (b >>> 0));
        pc++;
        break;
      }
      case 0x13: case 0x14: case 0x15: case 0x16: {
        if (sp < 2) { code = 2; break run; }
        const b = ds[--sp], a = ds[sp - 1];
        if (b === 0) { code = 4; break run; }
        ds[sp - 1] = op === 0x13
          ? (a === -2147483648 && b === -1 ? -2147483648 : (a / b) | 0)
          : op === 0x14
          ? (b === -1 ? 0 : a % b)
          : op === 0x15
          ? Math.floor((a >>> 0) / (b >>> 0)) | 0
          : ((a >>> 0) % (b >>> 0)) | 0;
        pc++;
        break;
      }
      case 0x17: case 0x1b: {
        if (sp < 1) { code = 2; break run; }
        ds[sp - 1] = op === 0x17 ? (-ds[sp - 1]) | 0 : ~ds[sp - 1];
        pc++;
        break;
      }
      case 0x1c: case 0x1d: case 0x1e: {
        if (sp < 2) { code = 2; break run; }
        const b = ds[--sp], a = ds[sp - 1];
        ds[sp - 1] = op === 0x1c ? a << (b & 31)
          : op === 0x1d ? a >> (b & 31)
          : (a >>> (b & 31)) | 0;
        pc++;
        break;
      }
      case 0x30:
        if (pc + 2 >= prog.length) { code = 9; break run; }
        pc = pc + 3 + prog.readInt16LE(pc + 1);
        break;
      case 0x31: case 0x32: {
        if (pc + 2 >= prog.length) { code = 9; break run; }
        if (sp < 1) { code = 2; break run; }
        const v = ds[--sp];
        const off = prog.readInt16LE(pc + 1);
        pc = (op === 0x31 ? v === 0 : v !== 0) ? pc + 3 + off : pc + 3;
        break;
      }
      case 0x33: {
        if (pc + 2 >= prog.length) { code = 9; break run; }
        if (cp >= 64) { code = 7; break run; }
        const target = prog[pc + 1] | (prog[pc + 2] << 8);
        cs[cp++] = pc + 3;
        pc = target;
        break;
      }
      case 0x34:
        if (cp === 0) { code = 8; break run; }
        pc = cs[--cp];
        break;
      case 0x40: {
        if (sp < 1) { code = 2; break run; }
        const addr = ds[sp - 1];
        if (addr < 0 || addr > 255) { code = 6; break run; }
        ds[sp - 1] = mem[addr];
        pc++;
        break;
      }
      case 0x41: {
        if (sp < 2) { code = 2; break run; }
        const addr = ds[sp - 1], v = ds[sp - 2];
        if (addr < 0 || addr > 255) { code = 6; break run; }
        mem[addr] = v;
        sp -= 2;
        pc++;
        break;
      }
      case 0x50: {
        if (sp < 1) { code = 2; break run; }
        const v = ds[--sp];
        const s = String(v);
        if (out.length + s.length > 65536) { code = 11; break run; }
        out.push(...Buffer.from(s));
        pc++;
        break;
      }
      case 0x51: {
        if (sp < 1) { code = 2; break run; }
        const v = ds[--sp];
        if (out.length + 1 > 65536) { code = 11; break run; }
        out.push(v & 255);
        pc++;
        break;
      }
      case 0x52:
        if (sp >= 256) { code = 3; break run; }
        ds[sp++] = ip < input.length ? input[ip++] : -1;
        pc++;
        break;
      case 0x53:
        if (sp < 1) { code = 2; break run; }
        code = ds[--sp] & 255;
        break run;
      default:
        code = 5;
        break run;
    }
  }
  return { out: Buffer.from(out), code };
}

const inDir = process.env.MAKEFUN_INPUT_DIR || "/input";
const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
const ids = fs.readdirSync(inDir).sort();
for (const id of ids) {
  const dir = path.join(inDir, id);
  const prog = fs.readFileSync(path.join(dir, "program.bin"));
  let input = Buffer.alloc(0);
  try { input = fs.readFileSync(path.join(dir, "input.bin")); } catch { /* no input */ }
  const r = runVM(prog, input);
  const od = path.join(outDir, id);
  fs.mkdirSync(od, { recursive: true });
  fs.writeFileSync(path.join(od, "stdout.bin"), r.out);
  fs.writeFileSync(path.join(od, "exit.txt"), String(r.code));
}
