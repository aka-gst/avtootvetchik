#!/usr/bin/env python3
"""
Локальный сервер для разработки: отдаёт файлы без кэша.

Обычный `python3 -m http.server` кэширование не запрещает, и браузер
держит модули у себя. Точка входа в index.html версионируется строкой
запроса, а импорты внутри неё — нет, поэтому правка в src/*.js может не
доехать до вкладки. Один раз на этом уже потеряли время: игра в браузере
вела себя так, будто исправления нет, хотя оно было.

    python3 serve.py [порт] [каталог]

По умолчанию 4190 и каталог рядом с этим файлом — чтобы сервер отдавал
игру, откуда бы его ни запустили. Слушает все интерфейсы: с телефона в
той же сети открывается по адресу вида http://192.168.x.x:4190/
"""

import functools
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4190
    root = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCache, directory=root)
    print(f'отдаётся {root}')
    http.server.test(HandlerClass=handler, port=port, bind='0.0.0.0')
