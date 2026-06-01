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

## MySQL accounts

The auth backend uses Railway MySQL automatically when one of these variables exists:

```txt
MYSQL_URL
```

or Railway's split variables:

```txt
MYSQLHOST
MYSQLUSER
MYSQLPASSWORD
MYSQLDATABASE
MYSQLPORT
```

When MySQL is configured, the server creates these tables automatically:

```txt
users
sessions
```

If MySQL variables are missing, the backend falls back to local `src/data/users.json`.

## Notes

- Local development still starts multiple ports: `8080`, `8081`, `8082`, `8083`.
- Railway public deployments use one port, so the client connects back to the same host with `wss://`.
- For production, use Railway MySQL so accounts survive redeploys.
