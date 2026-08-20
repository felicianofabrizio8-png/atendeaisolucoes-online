import { normalizePhone } from './src/lib/phone';

const testCases = [
  { input: "15988002521", expected: "5515988002521" },
  { input: "5515988002521", expected: "5515988002521" },
  { input: "(15) 98800-2521", expected: "5515988002521" },
  { input: "+55 15 98800-2521", expected: "5515988002521" },
  { input: "015988002521", expected: "5515988002521" },
  { input: "1532241234", expected: "551532241234" }, // fixo
];

testCases.forEach(({ input, expected }) => {
  const result = normalizePhone(input);
  if (result === expected) {
    console.log(`✅ ${input} -> ${result}`);
  } else {
    console.error(`❌ ${input} -> expected ${expected}, got ${result}`);
    process.exit(1);
  }
});

console.log("All tests passed!");
