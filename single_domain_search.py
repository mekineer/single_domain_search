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
from pathlib import Path

# from requirements.txt
import tldextract
from googlesearch import search
from selenium import webdriver, common
from db_controller import DBController
import requests

# from util.py
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
def matchDomain(original_url, urls):
    extracted = tldextract.extract(original_url)
    original_host = "{}.{}".format(extracted.domain, extracted.suffix)
    for u in urls:
        sextract = tldextract.extract(u)
        sub_host = "{}.{}".format(sextract.domain, sextract.suffix)
        custlog(f"orig: {original_host}, sub: {sub_host}")
        if extracted.domain == sextract.domain or sub_host in white_list_domains:
            continue
        else:
            return False
    if len(urls) < 1:
        print('matchDomain urls is an empty list')
        return True
    return True


#Keeping same domain redirects
def checkRedirects(new_url):
    try:
        headers = {'user-agent': 'Mozilla/5.0 (Linux; Android 8.1.0; SM-J701F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.92 Mobile Safari/537.36'}
        response = requests.get(new_url, allow_redirects=True, headers=headers)
    except Exception as e:
        custlog(f"Issue in checkRedirects with url: {new_url}")
        custlog(f"ERROR {e}")
    else:
        if 200 <= response.status_code <= 299:
            if len(response.history) != 0:
                for resp in response.history:
                    print(resp.status_code, resp.url)
                    custlog(f"{resp.status_code} {resp.url}")
                extracted = tldextract.extract(new_url)
                new_url_host = "{}.{}".format(extracted.domain, extracted.suffix)
                sextract = tldextract.extract(response.url)
                new_url_end_host = "{}.{}".format(sextract.domain, sextract.suffix)
                if extracted.domain == sextract.domain:
                    return False  # Not Redirected to different domain
            else:
                return False  # Not Redirected
        else:
            return True  # Redirected to 404 or error https://developer.mozilla.org/en-US/docs/Web/HTTP/Status


def find_urls(net_stat):
    a = []
    for i,k in enumerate(net_stat):
        print('processed from current batch',i,'backend items from',len(net_stat), end="\r")
        if "connectStart" in k:
                a.append(k["name"])
    return a


def get_src_urls(driver):
    srcs = []
    tags = ['iframe', 'script']
    for t in tags:
        elems = driver.find_elements_by_tag_name(t)
        for e in elems:
            s = e.get_attribute("src")
            if s:
                srcs.append(s)
    return srcs


def process_url(new_url):
    chrome_options = webdriver.ChromeOptions()
    chrome_options.add_argument("--ignore-certificate-errors")
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--disable-gpu')
    chrome_options.add_argument("--enable-javascript")
    chrome_options.add_argument('--user-agent=Mozilla/5.0 (Linux; Android 8.1.0; SM-J701F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.92 Mobile Safari/537.36')
    driver = webdriver.Chrome(executable_path="util/mac_os/chromedriver",
                              options=chrome_options)
    extracted_urls = []
    try:
        custlog(f"processing url: {new_url}")
        if not checkRedirects(new_url):
            driver.get(new_url)
            # time.sleep(config_data.page_delay)
            script_to_exec = "var performance = window.performance || window.mozPerformance || window.msPerformance || window.webkitPerformance || {}; var network = performance.getEntries() || {}; return network;";
            net_stat = driver.execute_script(script_to_exec)
            if config_data.save_htmls:
                Path("htmls").mkdir(parents=True, exist_ok=True)
                url_html_file = urllib.parse.quote(new_url, safe='')
                with open(f'htmls/{url_html_file}.html', 'w', encoding="utf-8") as f:
                    f.write(driver.page_source)
            print(new_url)
            extracted_urls = find_urls(net_stat)
            extracted_urls += get_src_urls(driver)
            extracted_urls = list(set(extracted_urls))
            custlog(f"extracted urls: {extracted_urls}")
        else:
            print(new_url)
            extracted_urls = ['none.because.404']
            return extracted_urls
    except common.exceptions.WebDriverException as e:
        custlog(f"ERROR {e}")
        print(f"failed to process: {new_url}\nError {e}")
        extracted_urls = ['none.because.selenium.error']
        return extracted_urls
    driver.quit()
    return extracted_urls


def check_staleness(last_date):	
    return (datetime.now() - last_date).days




if __name__ == '__main__':
    CONFIG_PATH = os.environ.get("CONF", "param.json")
    custlog(f"loading config from path: {CONFIG_PATH}")

    with open(CONFIG_PATH, "r") as cf:
        config_data = D2O(**json.loads(cf.read()))

    params = {
    'query' : config_data.query,
    'pause' : config_data.pause,
    'verify_ssl': False
    }
    # custlog(f"whitelist: {white_list_domains}")

    optional_params = {
    'min_date': config_data.optional.get('min_date', ''),
    'max_date' : config_data.optional.get('max_date', ''),
    'tld' : config_data.optional.get('tld', ''),
    'safe' : config_data.optional.get('safe', ''),
    'lang' : config_data.optional.get('lang', ''),
    'country' : config_data.optional.get('country', '')
    }

    optional_params_stripped = {k: v for k, v in optional_params.items() if v is None or ''}
    params_merge = {**params, **optional_params_stripped}

    query = config_data.query
    desired_count = config_data.output_file
    batch_limit = config_data.batch_limit
    output_file = config_data.output_file
    white_list_domains = config_data.whitelist
    page_delay = config_data.page_delay

    dbc.add_query_info(query)

    start_num = 0
    print("\nQuery in database is:",check_staleness(dbc.get_query_date(query)),"days old")	
    if(check_staleness(dbc.get_query_date(query))==0):	
        start_num = dbc.get_processed_count(query)	
    else:	
        start_num = 0	
    
    stats_processed = start_num
    found_current_batch = 0
    print("Current start_num:",start_num)

    try:
        while True:
            # stop_num = start_num + batch_limit
            quotient_start = (start_num // 10) * 10
            stop_num = batch_limit
            params_all = {'start': quotient_start, 'stop': stop_num, **params_merge}
            print('\ngoogle search parameters: ',params_all,'\n')
            custlog(f"searching google with params: {params_all}")
            # time.sleep((5)*numpy.random.random()+page_delay)

            search_urls = []
            for u in search(**params_all):
                print(u)
                search_urls.append(u)

            print(f"\nUrls recieved from google: {len(search_urls)}")
            custlog(f"Urls recieved from google: {len(search_urls)}")

            if len(search_urls) == 0:
                print("No Urls recieved from google: Exiting\n")
                exit(1)

            new_urls = []
            for i in search_urls:
                safe_url = urllib.parse.quote(i, safe='')
                if not dbc.get_visited(safe_url):
                    new_urls.append(i)

            print(f"New urls not in database: {len(new_urls)}\n")
            custlog(f"New urls not in database: {len(new_urls)}")

            for new_url in new_urls:
                stats_processed += 1
                safe_url = urllib.parse.quote(new_url, safe='')
                dbc.add_visited_url(safe_url)
                dbc.update_query_count(query,stats_processed)	

                ext_urls = process_url(new_url)
                print("\nTotal urls in database:",stats_processed,"\n")
                custlog(f"Total urls in database: {stats_processed}")
                # print(ext_urls)  # all backend resource urls

                if matchDomain(new_url, ext_urls):  # if ext_urls and matchDomain(new_url, ext_urls):
                    found_current_batch += 1
                    dbc.mark_url(safe_url, 1)
                    print(f"\n***************** FOUND URL: {new_url}\n")
                    custlog(f"FOUND DESIRED URL: {new_url}")

                    with open(output_file, 'a') as of:
                        of.write(f"{new_url}\n")
                        of.flush()

                    if found_current_batch == desired_count:
                        print(f"Found desired count of urls: {desired_count}")
                        custlog(f"Found desired count of urls: {desired_count}")
                        exit(0)

            start_num += batch_limit

    except Exception as e:
        custlog(e)
        print(f"[ERROR] Something went wrong. Please check scdn.log. . . {e} Exiting")