import type { SkillDef } from "../registry.js";

export const ctfAiMlSkill: SkillDef = {
  name: "ctf-ai-ml",
  description: "AI/ML challenges: adversarial examples, model extraction, prompt injection, membership inference, data poisoning, LoRA exploitation, LLM jailbreaking.",
  category: "ctf",
  userInvocable: true,
  content: () => `# CTF AI/ML

## Key Techniques

### Model Weight Analysis
- **Perturbation negation**: 2 * W_orig - W_chal recovers suppressed behavior
- **LoRA merging**: W_base + alpha * (B @ A) combines base + adapter
- **Model inversion**: optimize random input to match target output
- **Encoder collision**: find two distinct inputs yielding identical outputs

### Adversarial Examples
- **FGSM**: single-step, add signed gradient scaled by epsilon
- **PGD**: iterative FGSM with projection
- **C&W**: minimize perturbation norm while causing misclassification
- **Adversarial patches**: physical-world attack scenarios
- **Data poisoning**: inject backdoor triggers into training data

### LLM Attacks
- **Prompt injection**: override system instructions via user input
- **Jailbreaking**: bypass safety filters through role play, encoding, multi-turn
- **Token smuggling**: exploit tokenizer splits so filtered words pass as subword tokens
- **Tool use exploitation**: abuse function calling for unintended actions

### Model Extraction & Inference
- Query API to reconstruct parameters or decision boundaries
- Membership inference: confidence distribution reveals training data membership

### Gradient-Based Techniques
- Gradient-based input recovery: reconstruct private data from shared gradients
- Activation maximization: optimize input to peak a specific neuron

## When to Pivot
- Pure math/lattice → /ctf-crypto
- Compiled ML model (ONNX, TensorRT) → /ctf-reverse
- Game/puzzle using ML as wrapper → /ctf-misc`,
};
