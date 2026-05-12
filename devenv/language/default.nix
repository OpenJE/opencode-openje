# ./devenv/language/default.nix

{ ... }: {
  imports = [
    ./nix.nix
    ./javascript.nix
    ./typescript.nix
    ./bun.nix
  ];
}
