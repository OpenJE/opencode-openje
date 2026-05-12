# ./devenv/opencode/plugin/oh-my-openagent.nix

{ ... }: {
  files.".opencode/oh-my-openagent.jsonc".text = builtins.toJSON {
    "$schema" = "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/v4.0.0/assets/oh-my-opencode.schema.json";
    agents = {
      sisyphus =          { model = "opencode-go/kimi-k2.6"; };
      atlas =             { model = "opencode-go/kimi-k2.6"; };
      sisyphus-junior =   { model = "opencode-go/kimi-k2.6"; };
      multimodal-looker = { model = "opencode-go/kimi-k2.6"; };
      prometheus =        { model = "opencode-go/glm-5.1"; };
      metis =             { model = "opencode-go/glm-5.1"; };
      oracle =            { model = "opencode-go/glm-5.1"; };
      momus =             { model = "opencode-go/glm-5.1"; };
      librarian =         { model = "opencode-go/qwen3.5-plus"; };
      explore =           { model = "opencode-go/qwen3.5-plus"; };
      hephaestus =        { model = "opencode/gpt-5.5"; };
    };
    categories = {
      visual-engineering = { model = "opencode-go/glm-5.1"; };
      ultrabrain =         { model = "opencode-go/glm-5.1"; };
      deep =               { model = "opencode/gpt-5.5"; };
      artistry =           { model = "opencode/gemini-3.1-pro"; };
      quick =              { model = "opencode-go/minimax-m2.7"; };
      unspecified-high =   { model = "opencode-go/glm-5.1"; };
      unspecified-low =    { model = "opencode-go/kimi-k2.6"; };
      writing =            { model = "opencode-go/kimi-k2.6"; };
    };
  };
}
