// Example project: resume / recruiting entity extraction.
// In a real consumer project this import is `from "@interactkit/distill"`; here it points at
// the local source so the example runs in-repo (dogfooding).
import { defineConfig } from "../../src/define.js";

export default defineConfig({
  instruction: "Extract entities from this resume or recruiting text.",
  tags: [
    { name: "CANDIDATE", description: "The name of the job candidate or applicant" },
    { name: "ROLE", description: "A job title or position, e.g. Senior Backend Engineer" },
    { name: "COMPANY", description: "An employer or organization the candidate worked at" },
    { name: "SKILL", description: "A technical skill, tool, or technology, e.g. Kubernetes" },
    { name: "DEGREE", description: "An academic degree or qualification, e.g. BSc Computer Science" },
    { name: "YEARS", description: "A duration or amount of experience, e.g. 5 years" },
  ],
  examples: [
    {
      input: "Priya Nair, a Senior Data Scientist at Stripe with 6 years of experience, is fluent in Python and TensorFlow.",
      entities: [
        { text: "Priya Nair", tag: "CANDIDATE" },
        { text: "Senior Data Scientist", tag: "ROLE" },
        { text: "Stripe", tag: "COMPANY" },
        { text: "6 years", tag: "YEARS" },
        { text: "Python", tag: "SKILL" },
        { text: "TensorFlow", tag: "SKILL" },
      ],
    },
    {
      input: "Holds a BSc in Computer Science and has hands-on experience with Kubernetes and Terraform.",
      entities: [
        { text: "BSc in Computer Science", tag: "DEGREE" },
        { text: "Kubernetes", tag: "SKILL" },
        { text: "Terraform", tag: "SKILL" },
      ],
    },
    {
      // A negative example — no entities here.
      input: "Looking for a remote opportunity starting next quarter.",
      entities: [],
    },
  ],
  io: {
    data: "data.jsonl",
    cache: "cache.jsonl",
    output: "extractor.gen.ts",
  },
  label: { provider: "openai", model: "gpt-4o-mini", concurrency: 8 },
  synth: {
    provider: "openai",
    model: "gpt-5.4-mini",
    rounds: 6,
    population: { size: 4, survivors: 2, diversity: "per-tag-niche", crossover: true },
  },
});
