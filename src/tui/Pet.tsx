import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

export type PetMood = "idle" | "happy" | "sad" | "watching" | "installing";

interface Frame {
  lines: string[];
  color?: string;
}

const FRAMES: Record<PetMood, Frame[]> = {
  idle: [
    { lines: [" /\\_/\\  ", "( o.o ) ", " > ^ <  "] },
    { lines: [" /\\_/\\  ", "( o.o )~", " > ^ <  "] },
    { lines: [" /\\_/\\  ", "( o.o ) ", " > ^ < ~"] },
  ],
  happy: [
    { lines: [" /\\_/\\  ", "( ^.^ ) ", " > ^ < ♡"], color: "green" },
    { lines: [" /\\_/\\  ", "( ^.^ )~", " > ^ < ♡"], color: "green" },
  ],
  sad: [
    { lines: [" /\\_/\\  ", "( ;.; ) ", " > ^ <  "], color: "red" },
    { lines: [" /\\_/\\  ", "( ;.; ) ", " > ^ <  "], color: "red" },
  ],
  watching: [
    { lines: [" /\\_/\\  ", "( o.o ) ", " > ^ < ◌"], color: "yellow" },
    { lines: [" /\\_/\\  ", "( ◦.◦ ) ", " > ^ < ○"], color: "yellow" },
    { lines: [" /\\_/\\  ", "( o.o )~", " > ^ < ◌"], color: "yellow" },
  ],
  installing: [
    { lines: [" /\\_/\\  ", "( >.< ) ", " > ^ < ⚙"], color: "magenta" },
    { lines: [" /\\_/\\  ", "( >.<)~ ", " > ^ <  ⚙"], color: "magenta" },
    { lines: [" /\\_/\\  ", "( >.< ) ", " > ^ < ⚙"], color: "cyan" },
    { lines: [" /\\_/\\  ", "(~>.< ) ", " > ^ < ⚙"], color: "cyan" },
  ],
};

export function Pet({ mood }: { mood: PetMood }) {
  const [frame, setFrame] = useState(0);
  const frames = FRAMES[mood];

  useEffect(() => {
    if (frames.length <= 1) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % frames.length), 800);
    return () => clearInterval(timer);
  }, [frames]);

  useEffect(() => {
    setFrame(0);
  }, [mood]);

  const current = frames[frame % frames.length];

  return (
    <Box flexDirection="column">
      {current.lines.map((line, i) => (
        <Text key={i} color={current.color}>{line}</Text>
      ))}
    </Box>
  );
}
