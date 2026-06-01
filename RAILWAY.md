# Railway Deploy

Railway exposes one public port through the `PORT` environment variable. In Railway mode this project starts one public game server only.

## Start command

```sh
npm start
```

## Optional variables

Set `GAMEMODE_ID` to choose the single public mode:

```txt
0  = FFA
1  = Teams
2  = Hardcore
10 = Tournament
```

If `GAMEMODE_ID` is not set, the server uses `serverGamemode` from `src/gameserver.ini`.

## Notes

- Local development still starts multiple ports: `8080`, `8081`, `8082`, `8083`.
- Railway public deployments use one port, so the client connects back to the same host with `wss://`.
- The current account database is `src/data/users.json`. For production, move this to Railway MySQL/PostgreSQL so accounts survive redeploys.
