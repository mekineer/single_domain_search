# Generated by Django 3.1.2 on 2020-10-19 08:12

from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='QueryInfo',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('query', models.CharField(max_length=200)),
                ('query_date', models.DateTimeField(auto_now_add=True)),
                ('processed_count', models.IntegerField(default=0)),
            ],
            options={
                'db_table': 'query_info',
            },
        ),
        migrations.CreateModel(
            name='VisitedUrls',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('url', models.CharField(max_length=500)),
                ('begin_date', models.DateTimeField(auto_now_add=True)),
                ('mark', models.IntegerField(default=0)),
            ],
            options={
                'db_table': 'visited_urls',
            },
        ),
    ]