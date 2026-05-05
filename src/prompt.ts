import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export interface AskOptions {
  default?: string;
  hint?: string;
  validate?: (v: string) => string | null; // returns error message or null
  mask?: boolean;
}

export async function ask(question: string, opts: AskOptions = {}): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      if (opts.hint) console.log(`  ${dim(opts.hint)}`);
      const promptText =
        opts.default !== undefined
          ? `${question} ${dim(`[${opts.mask ? mask(opts.default) : opts.default}]`)}: `
          : `${question}: `;
      const raw = (await rl.question(promptText)).trim();
      const value = raw === "" && opts.default !== undefined ? opts.default : raw;
      if (opts.validate) {
        const err = opts.validate(value);
        if (err) {
          console.log(`  ${red("✖")} ${err}`);
          continue;
        }
      }
      return value;
    }
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const def = defaultYes ? "Y/n" : "y/N";
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const raw = (await rl.question(`${question} ${dim(`[${def}]`)}: `)).trim().toLowerCase();
    if (raw === "") return defaultYes;
    return raw === "y" || raw === "yes";
  } finally {
    rl.close();
  }
}

export async function selectOne(
  question: string,
  options: { value: string; label?: string }[],
  defaultValue?: string,
  hint?: string,
): Promise<string> {
  if (hint) console.log(`  ${dim(hint)}`);
  console.log(`${question}`);
  options.forEach((o, i) => {
    const marker = o.value === defaultValue ? "*" : " ";
    console.log(`  ${marker} ${i + 1}) ${o.label ?? o.value}`);
  });
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const raw = (
        await rl.question(`Choice ${dim(defaultValue ? `[${defaultValue}]` : "")}: `)
      ).trim();
      if (raw === "" && defaultValue) return defaultValue;
      const asNum = Number(raw);
      if (Number.isInteger(asNum) && asNum >= 1 && asNum <= options.length) {
        return options[asNum - 1]!.value;
      }
      const match = options.find((o) => o.value === raw);
      if (match) return match.value;
      console.log(`  ${red("✖")} pick a number 1-${options.length} or an exact value`);
    }
  } finally {
    rl.close();
  }
}

function mask(s: string): string {
  if (s.length <= 6) return "*".repeat(s.length);
  return s.slice(0, 3) + "…" + s.slice(-3);
}

const isTTY = stdout.isTTY;
function dim(s: string): string {
  return isTTY ? `\x1b[2m${s}\x1b[0m` : s;
}
function red(s: string): string {
  return isTTY ? `\x1b[31m${s}\x1b[0m` : s;
}
