
print('Sort whitelist alphabetically? (y/n)')
s = input()
if s == 'y':
    with open(CONFIG_PATH, 'r') as cf:
        config_temp = json.load(cf)
    config_temp["whitelist"].sort()
    with open(CONFIG_PATH, "w") as cf:
        json.dump(config_temp, cf, indent=2)