# ./devenv/opencode/default.nix

{ lib, ... }: {
  imports = [
    ./permission
    ./mcp
    ./plugin
    ./agent
    ./skill
    ./command
  ];

  opencode = {
    enable = true;

    settings = {
      provider = {
        lmstudio = {
          npm = "@ai-sdk/openai-compatible";
          name = "LM Studio";

          options = {
            baseURL = "http://127.0.0.1:1234/v1";
          };

          models = {
            "qwen3.6-27b" = {
              name = "Qwen 3.6 27B";
            };

            "qwen3.6-35b-a3b" = {
              name = "Qwen 3.6 35B A3B";
            };

            "glm-4.7-flash" = {
              name = "GLM 4.7 Flash";
            };

            "gemma-4-31b-it" = {
              name = "Gemma 4 31B IT";
            };

            "nvidia-nemotron-3-nano-omni-30b-a3b-reasoning" = {
              name = "Nvidia Nemotron 3 Nano Omni 30B A3B Reasoning";
            };
          };
        };
      };

      compaction = {
        auto = true;
        prune = true;
      };

      plugin = [
        "opencode-lmstudio@0.3.0"
        "oh-my-openagent@4.0.0"
        #"@tarquinen/opencode-dcp@3.1.5"
      ];
    };

    rules = lib.strings.removeSuffix "\n" ''
    '';
  };
}
