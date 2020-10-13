#!/usr/bin/env python
# -*- coding: utf-8 -*-'

import os
import sys
import numpy
import logging
from datetime import datetime
import json
import time
import urllib
import fileinput
from pathlib import Path
import warnings

# relating to requirements.txt
import tldextract
from googlesearch import search
from selenium import webdriver, common
from db_controller import DBController
import requests

# relating to util.py
from util import *

logger = get_logger('cdn')

LOGGER_LINE_NO = 0
def custlog(line):
    global LOGGER_LINE_NO
    LOGGER_LINE_NO+=1
    logger.debug(line)

dbc = DBController()

class Stats:
    processed = 0

stats = Stats()

class D2O:
    def __init__(self, **entries):
        self.__dict__.update(entries)


# without TLD comparing just domain
def matchDomain(new_url, resource_urls):
    extracted = tldextract.extract(new_url)
    for u in resource_urls:
        sextract = tldextract.extract(u)
        sub_host = "{}.{}".format(sextract.domain, sextract.suffix)
        if extracted.domain != sextract.domain and sub_host not in whitelist_domains:
            return False
    if len(resource_urls) < 1:
        print('matchDomain resource_urls is an empty list')  # Because 404. Even hello world site has one resource.
        return False
    return True


# keeping same domain redirects
def checkRedirects(new_url):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            headers = {'referer': 'https://www.google.com/','user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.92 Safari/537.36'}
            response = requests.get(new_url, allow_redirects=True, verify=False, headers=headers)
#       print("\nresponse.headers:",response.headers,"\n")
    except Exception as e:
        print(f"Issue in checkRedirects with url: {new_url}")
        custlog(f"Issue in checkRedirects with url: {new_url}")
        custlog(f"ERROR {e}")
    else:
        if 200 <= response.status_code <= 299:
            if len(response.history) != 0:
                for resp in response.history:
                    print(resp.status_code, resp.url)
                    custlog(f"{resp.status_code} {resp.url}")
                extracted = tldextract.extract(new_url)
                sextract = tldextract.extract(response.url)
                if extracted.domain == sextract.domain:
                    return False  # Not Redirected to different domain
            else:
                return False  # Not Redirected
        else:
            return True  # Redirected to 404 or error https://developer.mozilla.org/en-US/docs/Web/HTTP/Status


def is_valid(url):  # vikas
    parsed = urllib.parse.urlparse(url)
    return bool(parsed.netloc) and bool(parsed.scheme)


def find_urls(net_stat):
    a = []
    len_net_stat = len(net_stat)
    for i,k in enumerate(net_stat):
        print('processed from current batch',i,'backend items from',len(net_stat), end="\r")
        if "connectStart" in k:
                a.append(k["name"])
    print("")
    return a


def get_src_urls(driver):
    srcs = []
#   tags = ['iframe', 'script']  # https://www.w3schools.com/tags/att_src.asp
    tags = ['iframe', 'script','embed']
    for t in tags:
        elems = driver.find_elements_by_tag_name(t)
        for e in elems:
            s = e.get_attribute("src")
            if s and s != "" and is_valid(s):
                srcs.append(s)
#   print("")
#   for i in srcs:
#       print("  ",i)
    return srcs


def process_url(new_url):
    chrome_options = webdriver.ChromeOptions()
    chrome_options.add_argument("--ignore-certificate-errors")
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--disable-gpu')
    chrome_options.add_argument("--enable-javascript")
    chrome_options.add_argument("--disable-extensions")
    chrome_options.add_argument("--allow-running-insecure-content")
    chrome_options.add_argument("--unsafely-treat-insecure-origin-as-secure=http://host:port")
#   chrome_options.add_argument('--user-agent=Mozilla/5.0 (Linux; Android 8.1.0; SM-J701F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.92 Mobile Safari/537.36')
    chrome_options.add_argument('--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.92 Safari/537.36')
    driver = webdriver.Chrome(executable_path="E:\Github\single_domain_search\chromedriver_win32\chromedriver.exe",
                              options=chrome_options)
    resource_urls = []
    try:
        if not checkRedirects(new_url):
            driver.implicitly_wait(page_delay)
            driver.get(new_url)
            html = driver.page_source
            if len(html) == 0:
                print("Empty html, likely browser will not display because \"Not Secure\"")
                return resource_urls
            script_to_exec = "var performance = window.performance || window.mozPerformance || window.msPerformance || window.webkitPerformance || {}; var network = performance.getEntries() || {}; return network;";
            net_stat = driver.execute_script(script_to_exec)
            if config_data.save_htmls:
                Path("htmls").mkdir(parents=True, exist_ok=True)
                url_html_file = urllib.parse.quote(new_url, safe='')
                with open(f'htmls/{url_html_file}.html', 'w', encoding="utf-8") as f:
                    f.write(driver.page_source)
            resource_urls = find_urls(net_stat)
            resource_urls += get_src_urls(driver)
            resource_urls = list(set(resource_urls))
            custlog(f"resource urls: {resource_urls}")
    except common.exceptions.WebDriverException as e:
        custlog(f"ERROR {e}")
        print("Processing error",{e},end="\r")
        print("")
    driver.quit()
    return resource_urls


def check_staleness(last_date):	
    return (datetime.now() - last_date).days






if __name__ == '__main__':
    CONFIG_PATH = os.environ.get("CONF", "param.json")
    custlog(f"loading config from path: {CONFIG_PATH}")

    with open(CONFIG_PATH, "r") as cf:  
        config_data = D2O(**json.loads(cf.read()))

    query = config_data.query
    desired_count = config_data.desired_count
    batch_limit = config_data.batch_limit
    output_file = config_data.output_file
    whitelist_domains = config_data.whitelist
    pause_delay = config_data.pause_delay
    page_delay = config_data.page_delay
    custlog(f"whitelist: {whitelist_domains}")

    params = {
    'query' : config_data.query,
    'verify_ssl': False
    }

    optional_params = {
    'min_date': config_data.optional.get('min_date', ''),
    'max_date' : config_data.optional.get('max_date', ''),
    'tld' : config_data.optional.get('tld', ''),
    'safe' : config_data.optional.get('safe', ''),
    'lang' : config_data.optional.get('lang', ''),
    'country' : config_data.optional.get('country', '')
    }

    stop_num = batch_limit
    user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.131 Safari/537.36"
    optional_params_stripped = {k: v for k, v in optional_params.items() if v is None or ''}
    params_merge = { 'stop': stop_num, 'user_agent': user_agent, **params, **optional_params_stripped}

    filtered_results = 0
    session_total = 0    
    dbc.add_query_info(query)
    stats_processed = dbc.get_processed_count(query)
    query_age = check_staleness(dbc.get_query_date(query))
    print("\nQuery in database is:",query_age,"days old")
    if query_age == 0:
        start_num = (stats_processed // 10) * 10	
    else:	
        start_num = 0
    start_num = 80

    try:
        while True:
            # stop_num = start_num + batch_limit # turns out stop_num should be fixed
            pause = 5*numpy.random.random() + pause_delay
            params_all = {'start': start_num, 'pause': pause, **params_merge}

            print('\n\ngoogle search parameters: ',params_all,'\n')
            custlog(f"searching google with params: {params_all}")

            search_urls = []
            for u in search(**params_all):
                print(u)
                search_urls.append(u)

            search_urls_count = len(search_urls)
            session_total = session_total + search_urls_count

            print(f"\nUrls recieved from google: {search_urls_count}")
            custlog(f"Urls recieved from google: {search_urls_count}")
            print(f"Total Urls recieved this session: {session_total}")

            new_urls = []
            for i in search_urls:
                safe_url = urllib.parse.quote(i, safe='')
                if not dbc.get_visited(safe_url):
                    new_urls.append(i)

            print(f"New urls not in database: {len(new_urls)}")
            custlog(f"New urls not in database: {len(new_urls)}")

            for new_url in new_urls:

                print("Urls in database for this query:",stats_processed,"\n")
                custlog(f"Urls in database for this query: {stats_processed}\n")

                stats_processed += 1
                safe_url = urllib.parse.quote(new_url, safe='')
                dbc.add_visited_url(safe_url)
                dbc.update_query_count(query,stats_processed)

                print(new_url)
                custlog(f"processing url: {new_url}")

                resource_urls = process_url(new_url)
                # print(resource_urls)  # all backend resource urls

                if matchDomain(new_url, resource_urls):  # formerly: if resource_urls and matchDomain(new_url, resource_urls):
                    filtered_results += 1
                    dbc.mark_url(safe_url, 1)

                    print(f"***************** FOUND URL: {new_url}")
                    custlog(f"FOUND DESIRED URL: {new_url}")

                    with open(output_file, 'a') as of:
                        of.write(f"{new_url}\n")
                        of.flush()

                    if filtered_results == desired_count:
                        print(f"Found desired count of urls: {desired_count}")
                        custlog(f"Found desired count of urls: {desired_count}")
                        exit(0)

            if search_urls_count < batch_limit:
                print("Google results exhausted: Exiting\n")
                exit(1)

            start_num += batch_limit

    except Exception as e:
        custlog(e)
        print(f"[ERROR] Something went wrong. Please check scdn.log. . . {e} Exiting")