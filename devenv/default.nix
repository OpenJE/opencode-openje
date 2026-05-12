# ./devenv/default.nix

{ ... }: {
  imports = [
    ./environment
    ./language
    ./package
    ./process
    ./script
    ./service
    ./task
    ./opencode
  ];
}
